export class Cartridge {
    constructor(romData) {
        this.romData = romData;
        this.parseHeader();
    }
    
    parseHeader() {
        // Read cartridge header
        this.title = '';
        for (let i = 0x134; i < 0x144; i++) {
            if (this.romData[i] === 0) break;
            this.title += String.fromCharCode(this.romData[i]);
        }
        
        this.cartridgeType = this.romData[0x147];
        this.romSizeCode = this.romData[0x148];
        this.ramSizeCode = this.romData[0x149];
        
        // Calculate ROM size
        this.romSize = 32 * 1024 * (1 << this.romSizeCode);
        
        // Calculate RAM size
        switch (this.ramSizeCode) {
            case 0x00: this.ramSize = 0; break;
            case 0x01: this.ramSize = 2 * 1024; break;
            case 0x02: this.ramSize = 8 * 1024; break;
            case 0x03: this.ramSize = 32 * 1024; break;
            case 0x04: this.ramSize = 128 * 1024; break;
            case 0x05: this.ramSize = 64 * 1024; break;
            default: this.ramSize = 0; break;
        }
        
        // Determine ROM banks count
        this.romBanks = this.romSize / (16 * 1024);
        
        // Determine RAM banks count
        this.ramBanks = this.ramSize === 0 ? 0 : this.ramSize / (8 * 1024);
        
        // Determine MBC type
        switch (this.cartridgeType) {
            case 0x00: this.mbcType = 0; break; // ROM ONLY
            case 0x01: case 0x02: case 0x03: this.mbcType = 1; break; // MBC1
            case 0x05: case 0x06: this.mbcType = 2; break; // MBC2
            case 0x0F: case 0x10: case 0x11: case 0x12: case 0x13: this.mbcType = 3; break; // MBC3
            case 0x19: case 0x1A: case 0x1B: case 0x1C: case 0x1D: case 0x1E: this.mbcType = 5; break; // MBC5
            default: this.mbcType = 0; break; // Fallback to ROM ONLY
        }
        
        // Determine if battery is present
        this.hasBattery = [0x03, 0x06, 0x09, 0x0D, 0x0F, 0x10, 0x13, 0x1B, 0x1E].includes(this.cartridgeType);
        
        // Determine if RTC is present
        this.hasRTC = [0x0F, 0x10].includes(this.cartridgeType);
    }
    
    // Get ROM data
    getData() {
        return this.romData;
    }
    
    // Get MBC type
    getMBCType() {
        return this.mbcType;
    }
    
    // Get ROM banks count
    getROMBankCount() {
        return this.romBanks;
    }
    
    // Get RAM banks count
    getRAMBankCount() {
        return this.ramBanks;
    }
    
    // Get cartridge info
    getInfo() {
        // Get MBC type name
        let mbcTypeName = "Unknown";
        switch (this.mbcType) {
            case 0: mbcTypeName = "ROM ONLY"; break;
            case 1: mbcTypeName = "MBC1"; break;
            case 2: mbcTypeName = "MBC2"; break;
            case 3: mbcTypeName = "MBC3"; break;
            case 5: mbcTypeName = "MBC5"; break;
        }
        
        // Add battery info
        if (this.hasBattery) {
            mbcTypeName += " + BATTERY";
        }
        
        // Add RTC info
        if (this.hasRTC) {
            mbcTypeName += " + RTC";
        }
        
        return {
            title: this.title,
            cartridgeType: mbcTypeName,
            romSize: `${this.romSize / 1024}K (${this.romBanks} banks)`,
            ramSize: this.ramSize === 0 ? "None" : `${this.ramSize / 1024}K (${this.ramBanks} banks)`
        };
    }
}

