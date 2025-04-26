export class MMU {
    constructor() {
        // Memory areas
        this.rom = new Uint8Array(0x8000);          // 0x0000-0x7FFF: Cartridge ROM
        this.vram = new Uint8Array(0x2000);         // 0x8000-0x9FFF: Video RAM
        this.eram = new Uint8Array(0x8000);         // 0xA000-0xBFFF: External RAM (Cartridge)
        this.wram = new Uint8Array(0x2000);         // 0xC000-0xDFFF: Work RAM
        this.oam = new Uint8Array(0xA0);            // 0xFE00-0xFE9F: Sprite Attribute Table (OAM)
        this.io = new Uint8Array(0x80);             // 0xFF00-0xFF7F: I/O Registers
        this.hram = new Uint8Array(0x7F);           // 0xFF80-0xFFFE: High RAM
        this.ie = 0;                                // 0xFFFF: Interrupt Enable Register
        
        // MBC components
        this.cartridge = null;
        this.romBank = 1;                           // Current ROM bank (1 by default)
        this.ramBank = 0;                           // Current RAM bank
        this.ramEnabled = false;                    // External RAM enable flag
        this.romBankingMode = true;                 // ROM/RAM banking mode (for MBC1)
        
        // Components for I/O register access
        this.cpu = null;
        this.ppu = null;
        this.apu = null;
        this.timer = null;
        this.input = null;
    }
    
    connectComponents(cpu, ppu, apu, timer, input) {
        this.cpu = cpu;
        this.ppu = ppu;
        this.apu = apu;
        this.timer = timer;
        this.input = input;
    }
    
    loadCartridge(cartridge) {
        this.cartridge = cartridge;
        
        // Copy ROM data to ROM banks
        const romData = cartridge.getData();
        for (let i = 0; i < Math.min(romData.length, this.rom.length); i++) {
            this.rom[i] = romData[i];
        }
        
        // Reset MBC state
        this.romBank = 1;
        this.ramBank = 0;
        this.ramEnabled = false;
        this.romBankingMode = true;
    }
    
    reset() {
        // Clear memory
        this.vram.fill(0);
        this.eram.fill(0);
        this.wram.fill(0);
        this.oam.fill(0);
        this.io.fill(0);
        this.hram.fill(0);
        this.ie = 0;
        
        // Initialize I/O registers with default values
        this.io[0x00] = 0xCF;  // JOYP - Not pressed
        this.io[0x04] = 0xAB;  // DIV
        this.io[0x05] = 0x00;  // TIMA
        this.io[0x06] = 0x00;  // TMA
        this.io[0x07] = 0xF8;  // TAC
        this.io[0x0F] = 0xE1;  // IF
        this.io[0x10] = 0x80;  // NR10
        this.io[0x11] = 0xBF;  // NR11
        this.io[0x12] = 0xF3;  // NR12
        this.io[0x14] = 0xBF;  // NR14
        this.io[0x16] = 0x3F;  // NR21
        this.io[0x17] = 0x00;  // NR22
        this.io[0x19] = 0xBF;  // NR24
        this.io[0x1A] = 0x7F;  // NR30
        this.io[0x1B] = 0xFF;  // NR31
        this.io[0x1C] = 0x9F;  // NR32
        this.io[0x1E] = 0xBF;  // NR34
        this.io[0x20] = 0xFF;  // NR41
        this.io[0x21] = 0x00;  // NR42
        this.io[0x22] = 0x00;  // NR43
        this.io[0x23] = 0xBF;  // NR44
        this.io[0x24] = 0x77;  // NR50
        this.io[0x25] = 0xF3;  // NR51
        this.io[0x26] = 0xF1;  // NR52
        this.io[0x40] = 0x91;  // LCDC
        this.io[0x42] = 0x00;  // SCY
        this.io[0x43] = 0x00;  // SCX
        this.io[0x45] = 0x00;  // LYC
        this.io[0x47] = 0xFC;  // BGP
        this.io[0x48] = 0xFF;  // OBP0
        this.io[0x49] = 0xFF;  // OBP1
        this.io[0x4A] = 0x00;  // WY
        this.io[0x4B] = 0x00;  // WX
    }
    
    readByte(address) {
        address &= 0xFFFF; // Ensure 16-bit address
        
        // ROM - Cartridge
        if (address < 0x4000) {
            // Bank 0
            return this.rom[address];
        } 
        // Switchable ROM Bank
        else if (address < 0x8000) {
            const mappedAddress = ((this.romBank * 0x4000) + (address - 0x4000)) % this.rom.length;
            return this.rom[mappedAddress];
        } 
        // VRAM
        else if (address < 0xA000) {
            // Check if VRAM is accessible (not being used by PPU)
            if (this.ppu && this.ppu.isVRAMAccessible()) {
                return this.vram[address - 0x8000];
            }
            return 0xFF; // Not accessible during certain PPU modes
        } 
        // External RAM (on cartridge)
        else if (address < 0xC000) {
            // Check if RAM is enabled via MBC
            if (this.ramEnabled) {
                const mappedAddress = (this.ramBank * 0x2000) + (address - 0xA000);
                return this.eram[mappedAddress % this.eram.length];
            }
            return 0xFF;
        } 
        // Work RAM
        else if (address < 0xE000) {
            return this.wram[address - 0xC000];
        } 
        // Echo RAM (mirror of C000-DDFF)
        else if (address < 0xFE00) {
            return this.wram[address - 0xE000];
        } 
        // OAM - Sprite Attribute Table
        else if (address < 0xFEA0) {
            // Check if OAM is accessible (not being used by PPU)
            if (this.ppu && this.ppu.isOAMAccessible()) {
                return this.oam[address - 0xFE00];
            }
            return 0xFF; // Not accessible during certain PPU modes
        } 
        // Not usable memory
        else if (address < 0xFF00) {
            return 0xFF;
        } 
        // I/O Registers
        else if (address < 0xFF80) {
            const ioAddress = address - 0xFF00;
            
            // Special handling for certain I/O registers
            switch (address) {
                case 0xFF00: // JOYP
                    return this.input ? this.input.readJOYP() : this.io[0x00];
                    
                case 0xFF04: // DIV
                    return this.timer ? this.timer.readDIV() : this.io[0x04];
                    
                case 0xFF05: // TIMA
                    return this.timer ? this.timer.readTIMA() : this.io[0x05];
                    
                case 0xFF06: // TMA
                    return this.timer ? this.timer.readTMA() : this.io[0x06];
                    
                case 0xFF07: // TAC
                    return this.timer ? this.timer.readTAC() : this.io[0x07];
                    
                case 0xFF0F: // IF
                    return this.io[0x0F];
                    
                case 0xFF40: // LCDC
                case 0xFF41: // STAT
                case 0xFF42: // SCY
                case 0xFF43: // SCX
                case 0xFF44: // LY
                case 0xFF45: // LYC
                case 0xFF47: // BGP
                case 0xFF48: // OBP0
                case 0xFF49: // OBP1
                case 0xFF4A: // WY
                case 0xFF4B: // WX
                    return this.ppu ? this.ppu.readRegister(address) : this.io[ioAddress];
                    
                case 0xFF10: // NR10
                case 0xFF11: // NR11
                case 0xFF12: // NR12
                case 0xFF13: // NR13
                case 0xFF14: // NR14
                case 0xFF16: // NR21
                case 0xFF17: // NR22
                case 0xFF18: // NR23
                case 0xFF19: // NR24
                case 0xFF1A: // NR30
                case 0xFF1B: // NR31
                case 0xFF1C: // NR32
                case 0xFF1D: // NR33
                case 0xFF1E: // NR34
                case 0xFF20: // NR41
                case 0xFF21: // NR42
                case 0xFF22: // NR43
                case 0xFF23: // NR44
                case 0xFF24: // NR50
                case 0xFF25: // NR51
                case 0xFF26: // NR52
                    return this.apu ? this.apu.readRegister(address) : this.io[ioAddress];
                    
                default:
                    return this.io[ioAddress];
            }
        } 
        // High RAM
        else if (address < 0xFFFF) {
            return this.hram[address - 0xFF80];
        } 
        // Interrupt Enable Register
        else {
            return this.ie;
        }
    }
    
    writeByte(address, value) {
        address &= 0xFFFF; // Ensure 16-bit address
        value &= 0xFF;     // Ensure 8-bit value
        
        // ROM - Cartridge (MBC handling)
        if (address < 0x8000) {
            this.handleMBCWrite(address, value);
            return;
        } 
        // VRAM
        else if (address < 0xA000) {
            // Check if VRAM is accessible (not being used by PPU)
            if (this.ppu && this.ppu.isVRAMAccessible()) {
                this.vram[address - 0x8000] = value;
            }
            return;
        } 
        // External RAM (on cartridge)
        else if (address < 0xC000) {
            // Check if RAM is enabled via MBC
            if (this.ramEnabled) {
                const mappedAddress = (this.ramBank * 0x2000) + (address - 0xA000);
                this.eram[mappedAddress % this.eram.length] = value;
            }
            return;
        } 
        // Work RAM
        else if (address < 0xE000) {
            this.wram[address - 0xC000] = value;
            return;
        } 
        // Echo RAM (mirror of C000-DDFF)
        else if (address < 0xFE00) {
            this.wram[address - 0xE000] = value;
            return;
        } 
        // OAM - Sprite Attribute Table
        else if (address < 0xFEA0) {
            // Check if OAM is accessible (not being used by PPU)
            if (this.ppu && this.ppu.isOAMAccessible()) {
                this.oam[address - 0xFE00] = value;
            }
            return;
        } 
        // Not usable memory
        else if (address < 0xFF00) {
            return;
        } 
        // I/O Registers
        else if (address < 0xFF80) {
            const ioAddress = address - 0xFF00;
            
            // Special handling for certain I/O registers
            switch (address) {
                case 0xFF00: // JOYP
                    if (this.input) {
                        this.input.writeJOYP(value);
                    } else {
                        this.io[0x00] = value;
                    }
                    break;
                    
                case 0xFF04: // DIV
                    if (this.timer) {
                        this.timer.resetDIV();
                    } else {
                        this.io[0x04] = 0;
                    }
                    break;
                    
                case 0xFF05: // TIMA
                    if (this.timer) {
                        this.timer.writeTIMA(value);
                    } else {
                        this.io[0x05] = value;
                    }
                    break;
                    
                case 0xFF06: // TMA
                    if (this.timer) {
                        this.timer.writeTMA(value);
                    } else {
                        this.io[0x06] = value;
                    }
                    break;
                    
                case 0xFF07: // TAC
                    if (this.timer) {
                        this.timer.writeTAC(value);
                    } else {
                        this.io[0x07] = value;
                    }
                    break;
                    
                case 0xFF0F: // IF
                    this.io[0x0F] = value & 0x1F; // Only lower 5 bits used
                    break;
                    
                case 0xFF40: // LCDC
                case 0xFF41: // STAT
                case 0xFF42: // SCY
                case 0xFF43: // SCX
                case 0xFF45: // LYC
                case 0xFF47: // BGP
                case 0xFF48: // OBP0
                case 0xFF49: // OBP1
                case 0xFF4A: // WY
                case 0xFF4B: // WX
                    if (this.ppu) {
                        this.ppu.writeRegister(address, value);
                    } else {
                        this.io[ioAddress] = value;
                    }
                    break;
                    
                case 0xFF44: // LY - Read-only
                    break;
                    
                case 0xFF10: // NR10
                case 0xFF11: // NR11
                case 0xFF12: // NR12
                case 0xFF13: // NR13
                case 0xFF14: // NR14
                case 0xFF16: // NR21
                case 0xFF17: // NR22
                case 0xFF18: // NR23
                case 0xFF19: // NR24
                case 0xFF1A: // NR30
                case 0xFF1B: // NR31
                case 0xFF1C: // NR32
                case 0xFF1D: // NR33
                case 0xFF1E: // NR34
                case 0xFF20: // NR41
                case 0xFF21: // NR42
                case 0xFF22: // NR43
                case 0xFF23: // NR44
                case 0xFF24: // NR50
                case 0xFF25: // NR51
                case 0xFF26: // NR52
                    if (this.apu) {
                        this.apu.writeRegister(address, value);
                    } else {
                        this.io[ioAddress] = value;
                    }
                    break;
                    
                default:
                    this.io[ioAddress] = value;
                    break;
            }
            return;
        } 
        // High RAM
        else if (address < 0xFFFF) {
            this.hram[address - 0xFF80] = value;
            return;
        } 
        // Interrupt Enable Register
        else {
            this.ie = value;
            return;
        }
    }
    
    readWord(address) {
        const low = this.readByte(address);
        const high = this.readByte(address + 1);
        return (high << 8) | low;
    }
    
    writeWord(address, value) {
        this.writeByte(address, value & 0xFF);
        this.writeByte(address + 1, (value >> 8) & 0xFF);
    }
    
    handleMBCWrite(address, value) {
        if (!this.cartridge) return;
        
        const mbcType = this.cartridge.getMBCType();
        
        // MBC1
        if (mbcType >= 1 && mbcType <= 3) {
            // RAM Enable (0x0000-0x1FFF)
            if (address < 0x2000) {
                this.ramEnabled = (value & 0x0F) === 0x0A;
            }
            // ROM Bank Number (0x2000-0x3FFF)
            else if (address < 0x4000) {
                let bank = value & 0x1F;
                if (bank === 0) bank = 1;
                this.romBank = (this.romBank & 0x60) | bank;
                this.romBank %= this.cartridge.getROMBankCount();
            }
            // RAM Bank Number or Upper Bits of ROM Bank Number (0x4000-0x5FFF)
            else if (address < 0x6000) {
                if (this.romBankingMode) {
                    // Set upper bits of ROM bank
                    this.romBank = (this.romBank & 0x1F) | ((value & 0x03) << 5);
                    this.romBank %= this.cartridge.getROMBankCount();
                } else {
                    // Set RAM bank
                    this.ramBank = value & 0x03;
                    this.ramBank %= this.cartridge.getRAMBankCount();
                }
            }
            // ROM/RAM Mode Select (0x6000-0x7FFF)
            else if (address < 0x8000) {
                this.romBankingMode = (value & 0x01) === 0;
            }
        }
        // MBC2
        else if (mbcType === 5 || mbcType === 6) {
            // RAM Enable
            if (address < 0x2000) {
                // Only if bit 8 in the address is clear
                if ((address & 0x0100) === 0) {
                    this.ramEnabled = (value & 0x0F) === 0x0A;
                }
            }
            // ROM Bank Number
            else if (address < 0x4000 && (address & 0x0100) !== 0) {
                let bank = value & 0x0F;
                if (bank === 0) bank = 1;
                this.romBank = bank;
                this.romBank %= this.cartridge.getROMBankCount();
            }
        }
        // MBC3
        else if (mbcType >= 0x0F && mbcType <= 0x13) {
            // RAM Enable (0x0000-0x1FFF)
            if (address < 0x2000) {
                this.ramEnabled = (value & 0x0F) === 0x0A;
            }
            // ROM Bank Number (0x2000-0x3FFF)
            else if (address < 0x4000) {
                let bank = value & 0x7F;
                if (bank === 0) bank = 1;
                this.romBank = bank;
                this.romBank %= this.cartridge.getROMBankCount();
            }
            // RAM Bank Number or RTC Register Select (0x4000-0x5FFF)
            else if (address < 0x6000) {
                if (value <= 0x03) {
                    // RAM Bank
                    this.ramBank = value;
                    this.ramBank %= this.cartridge.getRAMBankCount();
                } else if (value >= 0x08 && value <= 0x0C) {
                    // RTC Register (not implemented yet)
                }
            }
            // Latch Clock Data (0x6000-0x7FFF)
            else if (address < 0x8000) {
                // RTC Latch (not implemented yet)
            }
        }
        // MBC5
        else if (mbcType >= 0x19 && mbcType <= 0x1E) {
            // RAM Enable (0x0000-0x1FFF)
            if (address < 0x2000) {
                this.ramEnabled = (value & 0x0F) === 0x0A;
            }
            // Low 8 bits of ROM Bank Number (0x2000-0x2FFF)
            else if (address < 0x3000) {
                this.romBank = (this.romBank & 0x100) | value;
                this.romBank %= this.cartridge.getROMBankCount();
            }
            // 9th bit of ROM Bank Number (0x3000-0x3FFF)
            else if (address < 0x4000) {
                this.romBank = (this.romBank & 0xFF) | ((value & 0x01) << 8);
                this.romBank %= this.cartridge.getROMBankCount();
            }
            // RAM Bank Number (0x4000-0x5FFF)
            else if (address < 0x6000) {
                this.ramBank = value & 0x0F;
                this.ramBank %= this.cartridge.getRAMBankCount();
            }
        }
    }
}

