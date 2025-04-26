export class CPU {
    constructor(mmu) {
        this.mmu = mmu;
        
        // CPU registers
        this.registers = {
            a: 0, // Accumulator
            f: 0, // Flags
            b: 0,
            c: 0,
            d: 0,
            e: 0,
            h: 0,
            l: 0,
            sp: 0, // Stack pointer
            pc: 0  // Program counter
        };
        
        // Flag bit positions
        this.flags = {
            Z: 7, // Zero flag
            N: 6, // Subtract flag
            H: 5, // Half carry flag
            C: 4  // Carry flag
        };
        
        // Interrupts
        this.ime = false; // Interrupt Master Enable
        this.pendingEnableInterrupts = false;
        
        this.halted = false;
        this.stopped = false;
        
        // Initialize instruction set
        this.initOpcodes();
        
        // Reset the CPU to initial state
        this.reset();
    }
    
    reset() {
        // Default register values after boot ROM
        this.registers.a = 0x01;
        this.registers.f = 0xB0;
        this.registers.b = 0x00;
        this.registers.c = 0x13;
        this.registers.d = 0x00;
        this.registers.e = 0xD8;
        this.registers.h = 0x01;
        this.registers.l = 0x4D;
        this.registers.sp = 0xFFFE;
        this.registers.pc = 0x0100; // Start of ROM after boot
        
        this.ime = false;
        this.pendingEnableInterrupts = false;
        this.halted = false;
        this.stopped = false;
    }
    
    // Get 16-bit register pairs
    get af() { return (this.registers.a << 8) | this.registers.f; }
    get bc() { return (this.registers.b << 8) | this.registers.c; }
    get de() { return (this.registers.d << 8) | this.registers.e; }
    get hl() { return (this.registers.h << 8) | this.registers.l; }
    
    // Set 16-bit register pairs
    set af(value) {
        this.registers.a = (value >> 8) & 0xFF;
        this.registers.f = value & 0xF0; // Lower 4 bits of F are always 0
    }
    
    set bc(value) {
        this.registers.b = (value >> 8) & 0xFF;
        this.registers.c = value & 0xFF;
    }
    
    set de(value) {
        this.registers.d = (value >> 8) & 0xFF;
        this.registers.e = value & 0xFF;
    }
    
    set hl(value) {
        this.registers.h = (value >> 8) & 0xFF;
        this.registers.l = value & 0xFF;
    }
    
    // Flag operations
    setFlag(flag, value) {
        if (value) {
            this.registers.f |= (1 << this.flags[flag]);
        } else {
            this.registers.f &= ~(1 << this.flags[flag]);
        }
    }
    
    getFlag(flag) {
        return (this.registers.f & (1 << this.flags[flag])) !== 0;
    }
    
    // Memory operations
    readByte(address) {
        return this.mmu.readByte(address);
    }
    
    readWord(address) {
        return this.mmu.readWord(address);
    }
    
    writeByte(address, value) {
        this.mmu.writeByte(address, value);
    }
    
    writeWord(address, value) {
        this.mmu.writeWord(address, value);
    }
    
    // Stack operations
    pushWord(value) {
        this.registers.sp = (this.registers.sp - 2) & 0xFFFF;
        this.writeWord(this.registers.sp, value);
    }
    
    popWord() {
        const value = this.readWord(this.registers.sp);
        this.registers.sp = (this.registers.sp + 2) & 0xFFFF;
        return value;
    }
    
    // CPU step function - executes one instruction
    step() {
        // Handle pending interrupts
        if (this.pendingEnableInterrupts) {
            this.ime = true;
            this.pendingEnableInterrupts = false;
        }
        
        // Check for interrupts
        if (this.ime || this.halted) {
            const triggered = this.handleInterrupts();
            if (triggered) {
                this.halted = false;
                return 20; // Interrupt handling takes 20 cycles
            }
        }
        
        if (this.halted) {
            return 4; // HALT mode takes 4 cycles per step
        }
        
        // Fetch opcode
        const opcode = this.readByte(this.registers.pc++);
        this.registers.pc &= 0xFFFF; // Ensure PC wraps around 16 bits
        
        // Execute instruction
        let instruction;
        
        if (opcode === 0xCB) {
            // CB-prefixed opcode
            const cbOpcode = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            instruction = this.cbOpcodes[cbOpcode];
        } else {
            // Standard opcode
            instruction = this.opcodes[opcode];
        }
        
        if (!instruction) {
            throw new Error(`Unknown opcode: 0x${opcode.toString(16)}`);
        }
        
        return instruction.call(this);
    }
    
    // Handle interrupts
    handleInterrupts() {
        const ie = this.readByte(0xFFFF);  // Interrupt Enable register
        const if_ = this.readByte(0xFF0F); // Interrupt Flag register
        
        if (ie & if_) {
            // At least one enabled interrupt is pending
            for (let i = 0; i < 5; i++) {
                if ((ie & (1 << i)) && (if_ & (1 << i))) {
                    // Clear the interrupt flag
                    this.writeByte(0xFF0F, if_ & ~(1 << i));
                    
                    if (this.ime) {
                        // Disable interrupts
                        this.ime = false;
                        
                        // Push PC to stack
                        this.pushWord(this.registers.pc);
                        
                        // Jump to interrupt handler
                        this.registers.pc = 0x40 + (i * 0x08);
                    }
                    
                    this.halted = false;
                    return true;
                }
            }
        }
        
        return false;
    }
    
    // Define opcode handlers
    initOpcodes() {
        // Main opcodes (non-CB prefixed)
        this.opcodes = Array(256).fill(null);
        
        // CB-prefixed opcodes
        this.cbOpcodes = Array(256).fill(null);
        
        // Helper for defining opcodes
        const define = (opcodes, code, handler) => {
            opcodes[code] = handler;
        };
        
        // 0x00: NOP - No operation
        define(this.opcodes, 0x00, function() { return 4; }); // NOP takes 4 cycles
        
        // 8-bit loads
        define(this.opcodes, 0x06, function() { this.registers.b = this.readByte(this.registers.pc++); this.registers.pc &= 0xFFFF; return 8; }); // LD B,n
        
        // LD r1,r2 instructions
        define(this.opcodes, 0x7F, function() { this.registers.a = this.registers.a; return 4; }); // LD A,A
        define(this.opcodes, 0x78, function() { this.registers.a = this.registers.b; return 4; }); // LD A,B
        define(this.opcodes, 0x79, function() { this.registers.a = this.registers.c; return 4; }); // LD A,C
        define(this.opcodes, 0x7A, function() { this.registers.a = this.registers.d; return 4; }); // LD A,D
        define(this.opcodes, 0x7B, function() { this.registers.a = this.registers.e; return 4; }); // LD A,E
        define(this.opcodes, 0x7C, function() { this.registers.a = this.registers.h; return 4; }); // LD A,H
        define(this.opcodes, 0x7D, function() { this.registers.a = this.registers.l; return 4; }); // LD A,L
        define(this.opcodes, 0x7E, function() { this.registers.a = this.readByte(this.hl); return 8; }); // LD A,(HL)
        
        define(this.opcodes, 0x40, function() { this.registers.b = this.registers.b; return 4; }); // LD B,B
        define(this.opcodes, 0x41, function() { this.registers.b = this.registers.c; return 4; }); // LD B,C
        define(this.opcodes, 0x42, function() { this.registers.b = this.registers.d; return 4; }); // LD B,D
        define(this.opcodes, 0x43, function() { this.registers.b = this.registers.e; return 4; }); // LD B,E
        define(this.opcodes, 0x44, function() { this.registers.b = this.registers.h; return 4; }); // LD B,H
        define(this.opcodes, 0x45, function() { this.registers.b = this.registers.l; return 4; }); // LD B,L
        define(this.opcodes, 0x46, function() { this.registers.b = this.readByte(this.hl); return 8; }); // LD B,(HL)
        
        // Load from (HL) to register
        define(this.opcodes, 0x46, function() { this.registers.b = this.readByte(this.hl); return 8; }); // LD B,(HL)
        define(this.opcodes, 0x4E, function() { this.registers.c = this.readByte(this.hl); return 8; }); // LD C,(HL)
        define(this.opcodes, 0x56, function() { this.registers.d = this.readByte(this.hl); return 8; }); // LD D,(HL)
        define(this.opcodes, 0x5E, function() { this.registers.e = this.readByte(this.hl); return 8; }); // LD E,(HL)
        define(this.opcodes, 0x66, function() { this.registers.h = this.readByte(this.hl); return 8; }); // LD H,(HL)
        define(this.opcodes, 0x6E, function() { this.registers.l = this.readByte(this.hl); return 8; }); // LD L,(HL)
        
        // Load register to (HL)
        define(this.opcodes, 0x70, function() { this.writeByte(this.hl, this.registers.b); return 8; }); // LD (HL),B
        define(this.opcodes, 0x71, function() { this.writeByte(this.hl, this.registers.c); return 8; }); // LD (HL),C
        define(this.opcodes, 0x72, function() { this.writeByte(this.hl, this.registers.d); return 8; }); // LD (HL),D
        define(this.opcodes, 0x73, function() { this.writeByte(this.hl, this.registers.e); return 8; }); // LD (HL),E
        define(this.opcodes, 0x74, function() { this.writeByte(this.hl, this.registers.h); return 8; }); // LD (HL),H
        define(this.opcodes, 0x75, function() { this.writeByte(this.hl, this.registers.l); return 8; }); // LD (HL),L
        define(this.opcodes, 0x36, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.writeByte(this.hl, n);
            return 12;
        }); // LD (HL),n
        
        // 16-bit loads
        define(this.opcodes, 0x01, function() { 
            this.bc = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            return 12;
        }); // LD BC,nn
        
        define(this.opcodes, 0x11, function() { 
            this.de = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            return 12;
        }); // LD DE,nn
        
        define(this.opcodes, 0x21, function() { 
            this.hl = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            return 12;
        }); // LD HL,nn
        
        define(this.opcodes, 0x31, function() { 
            this.registers.sp = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            return 12;
        }); // LD SP,nn
        
        // Stack operations
        define(this.opcodes, 0xC5, function() { this.pushWord(this.bc); return 16; }); // PUSH BC
        define(this.opcodes, 0xD5, function() { this.pushWord(this.de); return 16; }); // PUSH DE
        define(this.opcodes, 0xE5, function() { this.pushWord(this.hl); return 16; }); // PUSH HL
        define(this.opcodes, 0xF5, function() { this.pushWord(this.af); return 16; }); // PUSH AF
        
        define(this.opcodes, 0xC1, function() { this.bc = this.popWord(); return 12; }); // POP BC
        define(this.opcodes, 0xD1, function() { this.de = this.popWord(); return 12; }); // POP DE
        define(this.opcodes, 0xE1, function() { this.hl = this.popWord(); return 12; }); // POP HL
        define(this.opcodes, 0xF1, function() { this.af = this.popWord() & 0xFFF0; return 12; }); // POP AF (F lower 4 bits always 0)
        
        // 8-bit ALU
        define(this.opcodes, 0x80, function() { this.add(this.registers.b); return 4; }); // ADD A,B
        define(this.opcodes, 0x81, function() { this.add(this.registers.c); return 4; }); // ADD A,C
        define(this.opcodes, 0x82, function() { this.add(this.registers.d); return 4; }); // ADD A,D
        define(this.opcodes, 0x83, function() { this.add(this.registers.e); return 4; }); // ADD A,E
        define(this.opcodes, 0x84, function() { this.add(this.registers.h); return 4; }); // ADD A,H
        define(this.opcodes, 0x85, function() { this.add(this.registers.l); return 4; }); // ADD A,L
        define(this.opcodes, 0x86, function() { this.add(this.readByte(this.hl)); return 8; }); // ADD A,(HL)
        define(this.opcodes, 0x87, function() { this.add(this.registers.a); return 4; }); // ADD A,A
        define(this.opcodes, 0xC6, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.add(n);
            return 8;
        }); // ADD A,n
        
        // Control flow
        define(this.opcodes, 0xC3, function() { 
            this.registers.pc = this.readWord(this.registers.pc);
            return 16; 
        }); // JP nn
        
        define(this.opcodes, 0xC9, function() { 
            this.registers.pc = this.popWord();
            return 16; 
        }); // RET
        
        define(this.opcodes, 0xCD, function() { 
            const nn = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            this.pushWord(this.registers.pc);
            this.registers.pc = nn;
            return 24; 
        }); // CALL nn
        
        // Restarts
        define(this.opcodes, 0xC7, function() { this.pushWord(this.registers.pc); this.registers.pc = 0x00; return 16; }); // RST 00h
        define(this.opcodes, 0xCF, function() { this.pushWord(this.registers.pc); this.registers.pc = 0x08; return 16; }); // RST 08h
        define(this.opcodes, 0xD7, function() { this.pushWord(this.registers.pc); this.registers.pc = 0x10; return 16; }); // RST 10h
        define(this.opcodes, 0xDF, function() { this.pushWord(this.registers.pc); this.registers.pc = 0x18; return 16; }); // RST 18h
        define(this.opcodes, 0xE7, function() { this.pushWord(this.registers.pc); this.registers.pc = 0x20; return 16; }); // RST 20h
        define(this.opcodes, 0xEF, function() { this.pushWord(this.registers.pc); this.registers.pc = 0x28; return 16; }); // RST 28h
        define(this.opcodes, 0xF7, function() { this.pushWord(this.registers.pc); this.registers.pc = 0x30; return 16; }); // RST 30h
        define(this.opcodes, 0xFF, function() { this.pushWord(this.registers.pc); this.registers.pc = 0x38; return 16; }); // RST 38h
        
        // Conditional jumps
        define(this.opcodes, 0xC2, function() {
            if (!this.getFlag('Z')) {
                this.registers.pc = this.readWord(this.registers.pc);
                return 16;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // JP NZ,nn
        
        // Interrupts
        define(this.opcodes, 0xF3, function() { this.ime = false; return 4; }); // DI
        define(this.opcodes, 0xFB, function() { this.pendingEnableInterrupts = true; return 4; }); // EI
        
        // HALT and STOP
        define(this.opcodes, 0x76, function() { this.halted = true; return 4; }); // HALT
        define(this.opcodes, 0x10, function() { 
            this.registers.pc++; // Skip the next byte which is usually 0x00
            this.stopped = true; 
            return 4; 
        }); // STOP
        
        // CB-prefixed bit operations
        for (let i = 0; i < 8; i++) {
            // RLC r
            define(this.cbOpcodes, 0x00 + i, function() { this.rlc(i); return 8; });
            
            // RRC r
            define(this.cbOpcodes, 0x08 + i, function() { this.rrc(i); return 8; });
            
            // RL r
            define(this.cbOpcodes, 0x10 + i, function() { this.rl(i); return 8; });
            
            // RR r
            define(this.cbOpcodes, 0x18 + i, function() { this.rr(i); return 8; });
            
            // SLA r
            define(this.cbOpcodes, 0x20 + i, function() { this.sla(i); return 8; });
            
            // SRA r
            define(this.cbOpcodes, 0x28 + i, function() { this.sra(i); return 8; });
            
            // SWAP r
            define(this.cbOpcodes, 0x30 + i, function() { this.swap(i); return 8; });
            
            // SRL r
            define(this.cbOpcodes, 0x38 + i, function() { this.srl(i); return 8; });
        }
        
        // Bit operations
        for (let bit = 0; bit < 8; bit++) {
            for (let reg = 0; reg < 8; reg++) {
                // BIT b,r
                define(this.cbOpcodes, 0x40 + (bit * 8) + reg, function() {
                    this.testBit(bit, reg);
                    return reg === 6 ? 16 : 8; // (HL) takes 16 cycles
                });
                
                // RES b,r
                define(this.cbOpcodes, 0x80 + (bit * 8) + reg, function() {
                    this.resetBit(bit, reg);
                    return reg === 6 ? 16 : 8;
                });
                
                // SET b,r
                define(this.cbOpcodes, 0xC0 + (bit * 8) + reg, function() {
                    this.setBit(bit, reg);
                    return reg === 6 ? 16 : 8;
                });
            }
        }
    }
    
    // ALU helper functions
    add(value) {
        const a = this.registers.a;
        const result = a + value;
        
        this.setFlag('Z', (result & 0xFF) === 0);
        this.setFlag('N', false);
        this.setFlag('H', ((a & 0x0F) + (value & 0x0F)) > 0x0F);
        this.setFlag('C', result > 0xFF);
        
        this.registers.a = result & 0xFF;
    }
    
    // Implementation of bit operations
    rlc(regIndex) {
        let value = this.getRegisterValue(regIndex);
        const carry = (value & 0x80) !== 0;
        
        value = ((value << 1) & 0xFF) | (carry ? 1 : 0);
        this.setRegisterValue(regIndex, value);
        
        this.setFlag('Z', value === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', carry);
    }
    
    rrc(regIndex) {
        let value = this.getRegisterValue(regIndex);
        const carry = (value & 0x01) !== 0;
        
        value = (value >> 1) | (carry ? 0x80 : 0);
        this.setRegisterValue(regIndex, value);
        
        this.setFlag('Z', value === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', carry);
    }
    
    rl(regIndex) {
        let value = this.getRegisterValue(regIndex);
        const oldCarry = this.getFlag('C');
        const newCarry = (value & 0x80) !== 0;
        
        value = ((value << 1) & 0xFF) | (oldCarry ? 1 : 0);
        this.setRegisterValue(regIndex, value);
        
        this.setFlag('Z', value === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', newCarry);
    }
    
    rr(regIndex) {
        let value = this.getRegisterValue(regIndex);
        const oldCarry = this.getFlag('C');
        const newCarry = (value & 0x01) !== 0;
        
        value = (value >> 1) | (oldCarry ? 0x80 : 0);
        this.setRegisterValue(regIndex, value);
        
        this.setFlag('Z', value === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', newCarry);
    }
    
    sla(regIndex) {
        let value = this.getRegisterValue(regIndex);
        const carry = (value & 0x80) !== 0;
        
        value = (value << 1) & 0xFF;
        this.setRegisterValue(regIndex, value);
        
        this.setFlag('Z', value === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', carry);
    }
    
    sra(regIndex) {
        let value = this.getRegisterValue(regIndex);
        const msb = value & 0x80;
        const carry = (value & 0x01) !== 0;
        
        value = (value >> 1) | msb;
        this.setRegisterValue(regIndex, value);
        
        this.setFlag('Z', value === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', carry);
    }
    
    swap(regIndex) {
        let value = this.getRegisterValue(regIndex);
        
        value = ((value & 0x0F) << 4) | ((value & 0xF0) >> 4);
        this.setRegisterValue(regIndex, value);
        
        this.setFlag('Z', value === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', false);
    }
    
    srl(regIndex) {
        let value = this.getRegisterValue(regIndex);
        const carry = (value & 0x01) !== 0;
        
        value = value >> 1;
        this.setRegisterValue(regIndex, value);
        
        this.setFlag('Z', value === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', carry);
    }
    
    testBit(bit, regIndex) {
        const value = this.getRegisterValue(regIndex);
        const isZero = (value & (1 << bit)) === 0;
        
        this.setFlag('Z', isZero);
        this.setFlag('N', false);
        this.setFlag('H', true);
        // C flag unchanged
    }
    
    resetBit(bit, regIndex) {
        let value = this.getRegisterValue(regIndex);
        value &= ~(1 << bit);
        this.setRegisterValue(regIndex, value);
    }
    
    setBit(bit, regIndex) {
        let value = this.getRegisterValue(regIndex);
        value |= (1 << bit);
        this.setRegisterValue(regIndex, value);
    }
    
    // Helper to get register value based on index
    getRegisterValue(index) {
        switch (index) {
            case 0: return this.registers.b;
            case 1: return this.registers.c;
            case 2: return this.registers.d;
            case 3: return this.registers.e;
            case 4: return this.registers.h;
            case 5: return this.registers.l;
            case 6: return this.readByte(this.hl);
            case 7: return this.registers.a;
            default: throw new Error(`Invalid register index: ${index}`);
        }
    }
    
    // Helper to set register value based on index
    setRegisterValue(index, value) {
        switch (index) {
            case 0: this.registers.b = value; break;
            case 1: this.registers.c = value; break;
            case 2: this.registers.d = value; break;
            case 3: this.registers.e = value; break;
            case 4: this.registers.h = value; break;
            case 5: this.registers.l = value; break;
            case 6: this.writeByte(this.hl, value); break;
            case 7: this.registers.a = value; break;
            default: throw new Error(`Invalid register index: ${index}`);
        }
    }
}