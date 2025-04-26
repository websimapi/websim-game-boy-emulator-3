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
        
        // 0x01 - 0x0F: Various instructions
        define(this.opcodes, 0x01, function() { 
            this.bc = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            return 12;
        }); // LD BC,nn
        
        define(this.opcodes, 0x02, function() {
            this.writeByte(this.bc, this.registers.a);
            return 8;
        }); // LD (BC),A
        
        define(this.opcodes, 0x03, function() { 
            this.bc = (this.bc + 1) & 0xFFFF; 
            return 8; 
        }); // INC BC
        
        define(this.opcodes, 0x04, function() { 
            this.inc8(0); 
            return 4; 
        }); // INC B
        
        define(this.opcodes, 0x05, function() { 
            this.dec8(0); 
            return 4; 
        }); // DEC B
        
        define(this.opcodes, 0x06, function() { 
            this.registers.b = this.readByte(this.registers.pc++); 
            this.registers.pc &= 0xFFFF; 
            return 8; 
        }); // LD B,n
        
        define(this.opcodes, 0x07, function() { 
            // RLCA: Rotate A left with carry
            const carry = (this.registers.a & 0x80) !== 0;
            this.registers.a = ((this.registers.a << 1) & 0xFF) | (carry ? 1 : 0);
            this.setFlag('Z', false);
            this.setFlag('N', false);
            this.setFlag('H', false);
            this.setFlag('C', carry);
            return 4;
        }); // RLCA
        
        define(this.opcodes, 0x08, function() {
            const addr = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            this.writeWord(addr, this.registers.sp);
            return 20;
        }); // LD (a16),SP
        
        define(this.opcodes, 0x09, function() { 
            this.add16(this.bc); 
            return 8; 
        }); // ADD HL,BC
        
        define(this.opcodes, 0x0A, function() {
            this.registers.a = this.readByte(this.bc);
            return 8;
        }); // LD A,(BC)
        
        define(this.opcodes, 0x0B, function() { 
            this.bc = (this.bc - 1) & 0xFFFF; 
            return 8; 
        }); // DEC BC
        
        define(this.opcodes, 0x0C, function() { 
            this.inc8(1); 
            return 4; 
        }); // INC C
        
        define(this.opcodes, 0x0D, function() { 
            this.dec8(1); 
            return 4; 
        }); // DEC C
        
        define(this.opcodes, 0x0E, function() { 
            this.registers.c = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            return 8; 
        }); // LD C,d8
        
        define(this.opcodes, 0x0F, function() {
            // RRCA: Rotate A right with carry
            const carry = this.registers.a & 0x01;
            this.registers.a = (this.registers.a >> 1) | (carry ? 0x80 : 0);
            this.setFlag('Z', false);
            this.setFlag('N', false);
            this.setFlag('H', false);
            this.setFlag('C', carry === 1);
            return 4;
        }); // RRCA
        
        // 0x10 - 0x1F
        define(this.opcodes, 0x10, function() { 
            this.registers.pc++; // Skip the next byte which is usually 0x00
            this.stopped = true; 
            return 4; 
        }); // STOP
        
        define(this.opcodes, 0x11, function() { 
            this.de = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            return 12;
        }); // LD DE,nn
        
        define(this.opcodes, 0x12, function() {
            this.writeByte(this.de, this.registers.a);
            return 8;
        }); // LD (DE),A
        
        define(this.opcodes, 0x13, function() { 
            this.de = (this.de + 1) & 0xFFFF; 
            return 8; 
        }); // INC DE
        
        define(this.opcodes, 0x14, function() { 
            this.inc8(2); 
            return 4; 
        }); // INC D
        
        define(this.opcodes, 0x15, function() { 
            this.dec8(2); 
            return 4; 
        }); // DEC D
        
        define(this.opcodes, 0x16, function() { 
            this.registers.d = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            return 8; 
        }); // LD D,d8
        
        define(this.opcodes, 0x17, function() {
            // RLA: Rotate A left through carry
            const oldCarry = this.getFlag('C');
            const newCarry = (this.registers.a & 0x80) !== 0;
            this.registers.a = ((this.registers.a << 1) & 0xFF) | (oldCarry ? 1 : 0);
            this.setFlag('Z', false);
            this.setFlag('N', false);
            this.setFlag('H', false);
            this.setFlag('C', newCarry);
            return 4;
        }); // RLA
        
        define(this.opcodes, 0x18, function() {
            const offset = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            // Convert to signed offset
            this.registers.pc = (this.registers.pc + ((offset & 0x80) ? offset - 256 : offset)) & 0xFFFF;
            return 12;
        }); // JR r8
        
        define(this.opcodes, 0x19, function() { 
            this.add16(this.de); 
            return 8; 
        }); // ADD HL,DE
        
        define(this.opcodes, 0x1A, function() {
            this.registers.a = this.readByte(this.de);
            return 8;
        }); // LD A,(DE)
        
        define(this.opcodes, 0x1B, function() { 
            this.de = (this.de - 1) & 0xFFFF; 
            return 8; 
        }); // DEC DE
        
        define(this.opcodes, 0x1C, function() { 
            this.inc8(3); 
            return 4; 
        }); // INC E
        
        define(this.opcodes, 0x1D, function() { 
            this.dec8(3); 
            return 4; 
        }); // DEC E
        
        define(this.opcodes, 0x1E, function() { 
            this.registers.e = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            return 8; 
        }); // LD E,d8
        
        define(this.opcodes, 0x1F, function() {
            // RRA: Rotate A right through carry
            const oldCarry = this.getFlag('C');
            const newCarry = this.registers.a & 0x01;
            this.registers.a = (this.registers.a >> 1) | (oldCarry ? 0x80 : 0);
            this.setFlag('Z', false);
            this.setFlag('N', false);
            this.setFlag('H', false);
            this.setFlag('C', newCarry === 1);
            return 4;
        }); // RRA
        
        // 0x20 - 0x2F
        define(this.opcodes, 0x20, function() {
            const offset = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            if (!this.getFlag('Z')) {
                this.registers.pc = (this.registers.pc + ((offset & 0x80) ? offset - 256 : offset)) & 0xFFFF;
                return 12;
            }
            return 8;
        }); // JR NZ,r8
        
        define(this.opcodes, 0x21, function() { 
            this.hl = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            return 12;
        }); // LD HL,nn
        
        define(this.opcodes, 0x22, function() {
            this.writeByte(this.hl, this.registers.a);
            this.hl = (this.hl + 1) & 0xFFFF;
            return 8;
        }); // LD (HL+),A
        
        define(this.opcodes, 0x23, function() { 
            this.hl = (this.hl + 1) & 0xFFFF; 
            return 8; 
        }); // INC HL
        
        define(this.opcodes, 0x24, function() { 
            this.inc8(4); 
            return 4; 
        }); // INC H
        
        define(this.opcodes, 0x25, function() { 
            this.dec8(4); 
            return 4; 
        }); // DEC H
        
        define(this.opcodes, 0x26, function() { 
            this.registers.h = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            return 8; 
        }); // LD H,d8
        
        define(this.opcodes, 0x27, function() {
            // DAA: Decimal adjust A after addition or subtraction
            let adjust = 0;
            let carry = false;
            
            if (this.getFlag('H') || (!this.getFlag('N') && (this.registers.a & 0x0F) > 9)) {
                adjust |= 0x06;
            }
            
            if (this.getFlag('C') || (!this.getFlag('N') && this.registers.a > 0x99)) {
                adjust |= 0x60;
                carry = true;
            }
            
            this.registers.a = (this.registers.a + (this.getFlag('N') ? -adjust : adjust)) & 0xFF;
            
            this.setFlag('Z', this.registers.a === 0);
            this.setFlag('H', false);
            this.setFlag('C', carry);
            
            return 4;
        }); // DAA
        
        define(this.opcodes, 0x28, function() {
            const offset = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            if (this.getFlag('Z')) {
                this.registers.pc = (this.registers.pc + ((offset & 0x80) ? offset - 256 : offset)) & 0xFFFF;
                return 12;
            }
            return 8;
        }); // JR Z,r8
        
        define(this.opcodes, 0x29, function() { 
            this.add16(this.hl); 
            return 8; 
        }); // ADD HL,HL
        
        define(this.opcodes, 0x2A, function() {
            this.registers.a = this.readByte(this.hl);
            this.hl = (this.hl + 1) & 0xFFFF;
            return 8;
        }); // LD A,(HL+)
        
        define(this.opcodes, 0x2B, function() { 
            this.hl = (this.hl - 1) & 0xFFFF; 
            return 8; 
        }); // DEC HL
        
        define(this.opcodes, 0x2C, function() { 
            this.inc8(5); 
            return 4; 
        }); // INC L
        
        define(this.opcodes, 0x2D, function() { 
            this.dec8(5); 
            return 4; 
        }); // DEC L
        
        define(this.opcodes, 0x2E, function() { 
            this.registers.l = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            return 8; 
        }); // LD L,d8
        
        define(this.opcodes, 0x2F, function() {
            // CPL: Complement A (flip all bits)
            this.registers.a = (~this.registers.a) & 0xFF;
            this.setFlag('N', true);
            this.setFlag('H', true);
            return 4;
        }); // CPL
        
        // 0x30 - 0x3F
        define(this.opcodes, 0x30, function() {
            const offset = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            if (!this.getFlag('C')) {
                this.registers.pc = (this.registers.pc + ((offset & 0x80) ? offset - 256 : offset)) & 0xFFFF;
                return 12;
            }
            return 8;
        }); // JR NC,r8
        
        define(this.opcodes, 0x31, function() { 
            this.registers.sp = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            return 12;
        }); // LD SP,nn
        
        define(this.opcodes, 0x32, function() {
            this.writeByte(this.hl, this.registers.a);
            this.hl = (this.hl - 1) & 0xFFFF;
            return 8;
        }); // LD (HL-),A
        
        define(this.opcodes, 0x33, function() { 
            this.registers.sp = (this.registers.sp + 1) & 0xFFFF; 
            return 8; 
        }); // INC SP
        
        define(this.opcodes, 0x34, function() { 
            const val = this.readByte(this.hl);
            const result = this.inc8Value(val);
            this.writeByte(this.hl, result);
            return 12; 
        }); // INC (HL)
        
        define(this.opcodes, 0x35, function() { 
            const val = this.readByte(this.hl);
            const result = this.dec8Value(val);
            this.writeByte(this.hl, result);
            return 12; 
        }); // DEC (HL)
        
        define(this.opcodes, 0x36, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.writeByte(this.hl, n);
            return 12;
        }); // LD (HL),n
        
        define(this.opcodes, 0x37, function() {
            // SCF: Set carry flag
            this.setFlag('N', false);
            this.setFlag('H', false);
            this.setFlag('C', true);
            return 4;
        }); // SCF
        
        define(this.opcodes, 0x38, function() {
            const offset = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            if (this.getFlag('C')) {
                this.registers.pc = (this.registers.pc + ((offset & 0x80) ? offset - 256 : offset)) & 0xFFFF;
                return 12;
            }
            return 8;
        }); // JR C,r8
        
        define(this.opcodes, 0x39, function() { 
            this.add16(this.registers.sp); 
            return 8; 
        }); // ADD HL,SP
        
        define(this.opcodes, 0x3A, function() {
            this.registers.a = this.readByte(this.hl);
            this.hl = (this.hl - 1) & 0xFFFF;
            return 8;
        }); // LD A,(HL-)
        
        define(this.opcodes, 0x3B, function() { 
            this.registers.sp = (this.registers.sp - 1) & 0xFFFF; 
            return 8; 
        }); // DEC SP
        
        define(this.opcodes, 0x3C, function() { 
            this.inc8(7); 
            return 4; 
        }); // INC A
        
        define(this.opcodes, 0x3D, function() { 
            this.dec8(7); 
            return 4; 
        }); // DEC A
        
        define(this.opcodes, 0x3E, function() { 
            this.registers.a = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            return 8; 
        }); // LD A,d8
        
        define(this.opcodes, 0x3F, function() {
            // CCF: Complement carry flag
            this.setFlag('N', false);
            this.setFlag('H', false);
            this.setFlag('C', !this.getFlag('C'));
            return 4;
        }); // CCF
        
        // 0x40 - 0x7F: Register and memory loads
        // LD r1,r2 instructions
        define(this.opcodes, 0x40, function() { this.registers.b = this.registers.b; return 4; }); // LD B,B
        define(this.opcodes, 0x41, function() { this.registers.b = this.registers.c; return 4; }); // LD B,C
        define(this.opcodes, 0x42, function() { this.registers.b = this.registers.d; return 4; }); // LD B,D
        define(this.opcodes, 0x43, function() { this.registers.b = this.registers.e; return 4; }); // LD B,E
        define(this.opcodes, 0x44, function() { this.registers.b = this.registers.h; return 4; }); // LD B,H
        define(this.opcodes, 0x45, function() { this.registers.b = this.registers.l; return 4; }); // LD B,L
        define(this.opcodes, 0x46, function() { this.registers.b = this.readByte(this.hl); return 8; }); // LD B,(HL)
        define(this.opcodes, 0x47, function() { this.registers.b = this.registers.a; return 4; }); // LD B,A
        
        define(this.opcodes, 0x48, function() { this.registers.c = this.registers.b; return 4; }); // LD C,B
        define(this.opcodes, 0x49, function() { this.registers.c = this.registers.c; return 4; }); // LD C,C
        define(this.opcodes, 0x4A, function() { this.registers.c = this.registers.d; return 4; }); // LD C,D
        define(this.opcodes, 0x4B, function() { this.registers.c = this.registers.e; return 4; }); // LD C,E
        define(this.opcodes, 0x4C, function() { this.registers.c = this.registers.h; return 4; }); // LD C,H
        define(this.opcodes, 0x4D, function() { this.registers.c = this.registers.l; return 4; }); // LD C,L
        define(this.opcodes, 0x4E, function() { this.registers.c = this.readByte(this.hl); return 8; }); // LD C,(HL)
        define(this.opcodes, 0x4F, function() { this.registers.c = this.registers.a; return 4; }); // LD C,A
        
        define(this.opcodes, 0x50, function() { this.registers.d = this.registers.b; return 4; }); // LD D,B
        define(this.opcodes, 0x51, function() { this.registers.d = this.registers.c; return 4; }); // LD D,C
        define(this.opcodes, 0x52, function() { this.registers.d = this.registers.d; return 4; }); // LD D,D
        define(this.opcodes, 0x53, function() { this.registers.d = this.registers.e; return 4; }); // LD D,E
        define(this.opcodes, 0x54, function() { this.registers.d = this.registers.h; return 4; }); // LD D,H
        define(this.opcodes, 0x55, function() { this.registers.d = this.registers.l; return 4; }); // LD D,L
        define(this.opcodes, 0x56, function() { this.registers.d = this.readByte(this.hl); return 8; }); // LD D,(HL)
        define(this.opcodes, 0x57, function() { this.registers.d = this.registers.a; return 4; }); // LD D,A
        
        define(this.opcodes, 0x58, function() { this.registers.e = this.registers.b; return 4; }); // LD E,B
        define(this.opcodes, 0x59, function() { this.registers.e = this.registers.c; return 4; }); // LD E,C
        define(this.opcodes, 0x5A, function() { this.registers.e = this.registers.d; return 4; }); // LD E,D
        define(this.opcodes, 0x5B, function() { this.registers.e = this.registers.e; return 4; }); // LD E,E
        define(this.opcodes, 0x5C, function() { this.registers.e = this.registers.h; return 4; }); // LD E,H
        define(this.opcodes, 0x5D, function() { this.registers.e = this.registers.l; return 4; }); // LD E,L
        define(this.opcodes, 0x5E, function() { this.registers.e = this.readByte(this.hl); return 8; }); // LD E,(HL)
        define(this.opcodes, 0x5F, function() { this.registers.e = this.registers.a; return 4; }); // LD E,A
        
        define(this.opcodes, 0x60, function() { this.registers.h = this.registers.b; return 4; }); // LD H,B
        define(this.opcodes, 0x61, function() { this.registers.h = this.registers.c; return 4; }); // LD H,C
        define(this.opcodes, 0x62, function() { this.registers.h = this.registers.d; return 4; }); // LD H,D
        define(this.opcodes, 0x63, function() { this.registers.h = this.registers.e; return 4; }); // LD H,E
        define(this.opcodes, 0x64, function() { this.registers.h = this.registers.h; return 4; }); // LD H,H
        define(this.opcodes, 0x65, function() { this.registers.h = this.registers.l; return 4; }); // LD H,L
        define(this.opcodes, 0x66, function() { this.registers.h = this.readByte(this.hl); return 8; }); // LD H,(HL)
        define(this.opcodes, 0x67, function() { this.registers.h = this.registers.a; return 4; }); // LD H,A
        
        define(this.opcodes, 0x68, function() { this.registers.l = this.registers.b; return 4; }); // LD L,B
        define(this.opcodes, 0x69, function() { this.registers.l = this.registers.c; return 4; }); // LD L,C
        define(this.opcodes, 0x6A, function() { this.registers.l = this.registers.d; return 4; }); // LD L,D
        define(this.opcodes, 0x6B, function() { this.registers.l = this.registers.e; return 4; }); // LD L,E
        define(this.opcodes, 0x6C, function() { this.registers.l = this.registers.h; return 4; }); // LD L,H
        define(this.opcodes, 0x6D, function() { this.registers.l = this.registers.l; return 4; }); // LD L,L
        define(this.opcodes, 0x6E, function() { this.registers.l = this.readByte(this.hl); return 8; }); // LD L,(HL)
        define(this.opcodes, 0x6F, function() { this.registers.l = this.registers.a; return 4; }); // LD L,A
        
        define(this.opcodes, 0x70, function() { this.writeByte(this.hl, this.registers.b); return 8; }); // LD (HL),B
        define(this.opcodes, 0x71, function() { this.writeByte(this.hl, this.registers.c); return 8; }); // LD (HL),C
        define(this.opcodes, 0x72, function() { this.writeByte(this.hl, this.registers.d); return 8; }); // LD (HL),D
        define(this.opcodes, 0x73, function() { this.writeByte(this.hl, this.registers.e); return 8; }); // LD (HL),E
        define(this.opcodes, 0x74, function() { this.writeByte(this.hl, this.registers.h); return 8; }); // LD (HL),H
        define(this.opcodes, 0x75, function() { this.writeByte(this.hl, this.registers.l); return 8; }); // LD (HL),L
        define(this.opcodes, 0x76, function() { this.halted = true; return 4; }); // HALT
        define(this.opcodes, 0x77, function() { this.writeByte(this.hl, this.registers.a); return 8; }); // LD (HL),A
        
        define(this.opcodes, 0x78, function() { this.registers.a = this.registers.b; return 4; }); // LD A,B
        define(this.opcodes, 0x79, function() { this.registers.a = this.registers.c; return 4; }); // LD A,C
        define(this.opcodes, 0x7A, function() { this.registers.a = this.registers.d; return 4; }); // LD A,D
        define(this.opcodes, 0x7B, function() { this.registers.a = this.registers.e; return 4; }); // LD A,E
        define(this.opcodes, 0x7C, function() { this.registers.a = this.registers.h; return 4; }); // LD A,H
        define(this.opcodes, 0x7D, function() { this.registers.a = this.registers.l; return 4; }); // LD A,L
        define(this.opcodes, 0x7E, function() { this.registers.a = this.readByte(this.hl); return 8; }); // LD A,(HL)
        define(this.opcodes, 0x7F, function() { this.registers.a = this.registers.a; return 4; }); // LD A,A
        
        // 0x80 - 0xBF: Arithmetic and logic operations
        // ADD opcodes
        define(this.opcodes, 0x80, function() { this.add(this.registers.b); return 4; }); // ADD A,B
        define(this.opcodes, 0x81, function() { this.add(this.registers.c); return 4; }); // ADD A,C
        define(this.opcodes, 0x82, function() { this.add(this.registers.d); return 4; }); // ADD A,D
        define(this.opcodes, 0x83, function() { this.add(this.registers.e); return 4; }); // ADD A,E
        define(this.opcodes, 0x84, function() { this.add(this.registers.h); return 4; }); // ADD A,H
        define(this.opcodes, 0x85, function() { this.add(this.registers.l); return 4; }); // ADD A,L
        define(this.opcodes, 0x86, function() { this.add(this.readByte(this.hl)); return 8; }); // ADD A,(HL)
        define(this.opcodes, 0x87, function() { this.add(this.registers.a); return 4; }); // ADD A,A
        
        // ADC opcodes
        define(this.opcodes, 0x88, function() { this.adc(this.registers.b); return 4; }); // ADC A,B
        define(this.opcodes, 0x89, function() { this.adc(this.registers.c); return 4; }); // ADC A,C
        define(this.opcodes, 0x8A, function() { this.adc(this.registers.d); return 4; }); // ADC A,D
        define(this.opcodes, 0x8B, function() { this.adc(this.registers.e); return 4; }); // ADC A,E
        define(this.opcodes, 0x8C, function() { this.adc(this.registers.h); return 4; }); // ADC A,H
        define(this.opcodes, 0x8D, function() { this.adc(this.registers.l); return 4; }); // ADC A,L
        define(this.opcodes, 0x8E, function() { this.adc(this.readByte(this.hl)); return 8; }); // ADC A,(HL)
        define(this.opcodes, 0x8F, function() { this.adc(this.registers.a); return 4; }); // ADC A,A
        
        // SUB opcodes
        define(this.opcodes, 0x90, function() { this.sub(this.registers.b); return 4; }); // SUB B
        define(this.opcodes, 0x91, function() { this.sub(this.registers.c); return 4; }); // SUB C
        define(this.opcodes, 0x92, function() { this.sub(this.registers.d); return 4; }); // SUB D
        define(this.opcodes, 0x93, function() { this.sub(this.registers.e); return 4; }); // SUB E
        define(this.opcodes, 0x94, function() { this.sub(this.registers.h); return 4; }); // SUB H
        define(this.opcodes, 0x95, function() { this.sub(this.registers.l); return 4; }); // SUB L
        define(this.opcodes, 0x96, function() { this.sub(this.readByte(this.hl)); return 8; }); // SUB (HL)
        define(this.opcodes, 0x97, function() { this.sub(this.registers.a); return 4; }); // SUB A
        
        // SBC opcodes
        define(this.opcodes, 0x98, function() { this.sbc(this.registers.b); return 4; }); // SBC A,B
        define(this.opcodes, 0x99, function() { this.sbc(this.registers.c); return 4; }); // SBC A,C
        define(this.opcodes, 0x9A, function() { this.sbc(this.registers.d); return 4; }); // SBC A,D
        define(this.opcodes, 0x9B, function() { this.sbc(this.registers.e); return 4; }); // SBC A,E
        define(this.opcodes, 0x9C, function() { this.sbc(this.registers.h); return 4; }); // SBC A,H
        define(this.opcodes, 0x9D, function() { this.sbc(this.registers.l); return 4; }); // SBC A,L
        define(this.opcodes, 0x9E, function() { this.sbc(this.readByte(this.hl)); return 8; }); // SBC A,(HL)
        define(this.opcodes, 0x9F, function() { this.sbc(this.registers.a); return 4; }); // SBC A,A
        
        // AND opcodes
        define(this.opcodes, 0xA0, function() { this.and(this.registers.b); return 4; }); // AND B
        define(this.opcodes, 0xA1, function() { this.and(this.registers.c); return 4; }); // AND C
        define(this.opcodes, 0xA2, function() { this.and(this.registers.d); return 4; }); // AND D
        define(this.opcodes, 0xA3, function() { this.and(this.registers.e); return 4; }); // AND E
        define(this.opcodes, 0xA4, function() { this.and(this.registers.h); return 4; }); // AND H
        define(this.opcodes, 0xA5, function() { this.and(this.registers.l); return 4; }); // AND L
        define(this.opcodes, 0xA6, function() { this.and(this.readByte(this.hl)); return 8; }); // AND (HL)
        define(this.opcodes, 0xA7, function() { this.and(this.registers.a); return 4; }); // AND A
        
        // XOR opcodes
        define(this.opcodes, 0xA8, function() { this.xor(this.registers.b); return 4; }); // XOR B
        define(this.opcodes, 0xA9, function() { this.xor(this.registers.c); return 4; }); // XOR C
        define(this.opcodes, 0xAA, function() { this.xor(this.registers.d); return 4; }); // XOR D
        define(this.opcodes, 0xAB, function() { this.xor(this.registers.e); return 4; }); // XOR E
        define(this.opcodes, 0xAC, function() { this.xor(this.registers.h); return 4; }); // XOR H
        define(this.opcodes, 0xAD, function() { this.xor(this.registers.l); return 4; }); // XOR L
        define(this.opcodes, 0xAE, function() { this.xor(this.readByte(this.hl)); return 8; }); // XOR (HL)
        define(this.opcodes, 0xAF, function() { this.xor(this.registers.a); return 4; }); // XOR A
        
        // OR opcodes
        define(this.opcodes, 0xB0, function() { this.or(this.registers.b); return 4; }); // OR B
        define(this.opcodes, 0xB1, function() { this.or(this.registers.c); return 4; }); // OR C
        define(this.opcodes, 0xB2, function() { this.or(this.registers.d); return 4; }); // OR D
        define(this.opcodes, 0xB3, function() { this.or(this.registers.e); return 4; }); // OR E
        define(this.opcodes, 0xB4, function() { this.or(this.registers.h); return 4; }); // OR H
        define(this.opcodes, 0xB5, function() { this.or(this.registers.l); return 4; }); // OR L
        define(this.opcodes, 0xB6, function() { this.or(this.readByte(this.hl)); return 8; }); // OR (HL)
        define(this.opcodes, 0xB7, function() { this.or(this.registers.a); return 4; }); // OR A
        
        // CP opcodes (compare with A but don't store result)
        define(this.opcodes, 0xB8, function() { this.cp(this.registers.b); return 4; }); // CP B
        define(this.opcodes, 0xB9, function() { this.cp(this.registers.c); return 4; }); // CP C
        define(this.opcodes, 0xBA, function() { this.cp(this.registers.d); return 4; }); // CP D
        define(this.opcodes, 0xBB, function() { this.cp(this.registers.e); return 4; }); // CP E
        define(this.opcodes, 0xBC, function() { this.cp(this.registers.h); return 4; }); // CP H
        define(this.opcodes, 0xBD, function() { this.cp(this.registers.l); return 4; }); // CP L
        define(this.opcodes, 0xBE, function() { this.cp(this.readByte(this.hl)); return 8; }); // CP (HL)
        define(this.opcodes, 0xBF, function() { this.cp(this.registers.a); return 4; }); // CP A
        
        // 0xC0 - 0xFF: Control flow, stack operations, and misc
        // Return operations
        define(this.opcodes, 0xC0, function() {
            if (!this.getFlag('Z')) {
                this.registers.pc = this.popWord();
                return 20;
            }
            return 8;
        }); // RET NZ
        
        define(this.opcodes, 0xC1, function() { this.bc = this.popWord(); return 12; }); // POP BC
        
        define(this.opcodes, 0xC2, function() {
            if (!this.getFlag('Z')) {
                this.registers.pc = this.readWord(this.registers.pc);
                return 16;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // JP NZ,nn
        
        define(this.opcodes, 0xC3, function() { 
            this.registers.pc = this.readWord(this.registers.pc);
            return 16; 
        }); // JP nn
        
        define(this.opcodes, 0xC4, function() {
            if (!this.getFlag('Z')) {
                const addr = this.readWord(this.registers.pc);
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                this.pushWord(this.registers.pc);
                this.registers.pc = addr;
                return 24;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // CALL NZ,nn
        
        define(this.opcodes, 0xC5, function() { this.pushWord(this.bc); return 16; }); // PUSH BC
        
        define(this.opcodes, 0xC6, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.add(n);
            return 8;
        }); // ADD A,n
        
        define(this.opcodes, 0xC7, function() { 
            this.pushWord(this.registers.pc); 
            this.registers.pc = 0x00; 
            return 16; 
        }); // RST 00H
        
        define(this.opcodes, 0xC8, function() {
            if (this.getFlag('Z')) {
                this.registers.pc = this.popWord();
                return 20;
            }
            return 8;
        }); // RET Z
        
        define(this.opcodes, 0xC9, function() { 
            this.registers.pc = this.popWord();
            return 16; 
        }); // RET
        
        define(this.opcodes, 0xCA, function() {
            if (this.getFlag('Z')) {
                this.registers.pc = this.readWord(this.registers.pc);
                return 16;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // JP Z,nn
        
        // CB prefix
        define(this.opcodes, 0xCB, function() {
            // No-op for prefix - the actual opcode will be handled separately
            return 0;
        }); // PREFIX CB
        
        define(this.opcodes, 0xCC, function() {
            if (this.getFlag('Z')) {
                const addr = this.readWord(this.registers.pc);
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                this.pushWord(this.registers.pc);
                this.registers.pc = addr;
                return 24;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // CALL Z,nn
        
        define(this.opcodes, 0xCD, function() { 
            const nn = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            this.pushWord(this.registers.pc);
            this.registers.pc = nn;
            return 24; 
        }); // CALL nn
        
        define(this.opcodes, 0xCE, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.adc(n);
            return 8;
        }); // ADC A,n
        
        define(this.opcodes, 0xCF, function() { 
            this.pushWord(this.registers.pc); 
            this.registers.pc = 0x08; 
            return 16; 
        }); // RST 08H
        
        define(this.opcodes, 0xD0, function() {
            if (!this.getFlag('C')) {
                this.registers.pc = this.popWord();
                return 20;
            }
            return 8;
        }); // RET NC
        
        define(this.opcodes, 0xD1, function() { this.de = this.popWord(); return 12; }); // POP DE
        
        define(this.opcodes, 0xD2, function() {
            if (!this.getFlag('C')) {
                this.registers.pc = this.readWord(this.registers.pc);
                return 16;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // JP NC,nn
        
        // 0xD3 is an illegal opcode
        
        define(this.opcodes, 0xD4, function() {
            if (!this.getFlag('C')) {
                const addr = this.readWord(this.registers.pc);
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                this.pushWord(this.registers.pc);
                this.registers.pc = addr;
                return 24;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // CALL NC,nn
        
        define(this.opcodes, 0xD5, function() { this.pushWord(this.de); return 16; }); // PUSH DE
        
        define(this.opcodes, 0xD6, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.sub(n);
            return 8;
        }); // SUB n
        
        define(this.opcodes, 0xD7, function() { 
            this.pushWord(this.registers.pc); 
            this.registers.pc = 0x10; 
            return 16; 
        }); // RST 10H
        
        define(this.opcodes, 0xD8, function() {
            if (this.getFlag('C')) {
                this.registers.pc = this.popWord();
                return 20;
            }
            return 8;
        }); // RET C
        
        define(this.opcodes, 0xD9, function() { 
            this.registers.pc = this.popWord();
            this.ime = true;
            return 16; 
        }); // RETI
        
        define(this.opcodes, 0xDA, function() {
            if (this.getFlag('C')) {
                this.registers.pc = this.readWord(this.registers.pc);
                return 16;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // JP C,nn
        
        // 0xDB is an illegal opcode
        
        define(this.opcodes, 0xDC, function() {
            if (this.getFlag('C')) {
                const addr = this.readWord(this.registers.pc);
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                this.pushWord(this.registers.pc);
                this.registers.pc = addr;
                return 24;
            } else {
                this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
                return 12;
            }
        }); // CALL C,nn
        
        // 0xDD is an illegal opcode
        
        define(this.opcodes, 0xDE, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.sbc(n);
            return 8;
        }); // SBC A,n
        
        define(this.opcodes, 0xDF, function() { 
            this.pushWord(this.registers.pc); 
            this.registers.pc = 0x18; 
            return 16; 
        }); // RST 18H
        
        define(this.opcodes, 0xE0, function() {
            const offset = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.writeByte(0xFF00 + offset, this.registers.a);
            return 12;
        }); // LDH (a8),A
        
        define(this.opcodes, 0xE1, function() { this.hl = this.popWord(); return 12; }); // POP HL
        
        define(this.opcodes, 0xE2, function() {
            this.writeByte(0xFF00 + this.registers.c, this.registers.a);
            return 8;
        }); // LD (C),A
        
        // 0xE3, 0xE4 are illegal opcodes
        
        define(this.opcodes, 0xE5, function() { this.pushWord(this.hl); return 16; }); // PUSH HL
        
        define(this.opcodes, 0xE6, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.and(n);
            return 8;
        }); // AND n
        
        define(this.opcodes, 0xE7, function() { 
            this.pushWord(this.registers.pc); 
            this.registers.pc = 0x20; 
            return 16; 
        }); // RST 20H
        
        define(this.opcodes, 0xE8, function() {
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            
            // Convert to signed offset
            const offset = (n & 0x80) ? n - 256 : n;
            
            const sp = this.registers.sp;
            const result = (sp + offset) & 0xFFFF;
            
            // Set flags
            this.setFlag('Z', false);
            this.setFlag('N', false);
            this.setFlag('H', ((sp ^ offset ^ result) & 0x10) !== 0);
            this.setFlag('C', ((sp ^ offset ^ result) & 0x100) !== 0);
            
            this.registers.sp = result;
            return 16;
        }); // ADD SP,r8
        
        define(this.opcodes, 0xE9, function() {
            this.registers.pc = this.hl;
            return 4;
        }); // JP (HL)
        
        define(this.opcodes, 0xEA, function() {
            const addr = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            this.writeByte(addr, this.registers.a);
            return 16;
        }); // LD (a16),A
        
        // 0xEB, 0xEC, 0xED are illegal opcodes
        
        define(this.opcodes, 0xEE, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.xor(n);
            return 8;
        }); // XOR n
        
        define(this.opcodes, 0xEF, function() { 
            this.pushWord(this.registers.pc); 
            this.registers.pc = 0x28; 
            return 16; 
        }); // RST 28H
        
        define(this.opcodes, 0xF0, function() {
            const offset = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.registers.a = this.readByte(0xFF00 + offset);
            return 12;
        }); // LDH A,(a8)
        
        define(this.opcodes, 0xF1, function() { this.af = this.popWord() & 0xFFF0; return 12; }); // POP AF
        
        define(this.opcodes, 0xF2, function() {
            this.registers.a = this.readByte(0xFF00 + this.registers.c);
            return 8;
        }); // LD A,(C)
        
        define(this.opcodes, 0xF3, function() { this.ime = false; return 4; }); // DI
        
        // 0xF4 is an illegal opcode
        
        define(this.opcodes, 0xF5, function() { this.pushWord(this.af); return 16; }); // PUSH AF
        
        define(this.opcodes, 0xF6, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.or(n);
            return 8;
        }); // OR n
        
        define(this.opcodes, 0xF7, function() { 
            this.pushWord(this.registers.pc); 
            this.registers.pc = 0x30; 
            return 16; 
        }); // RST 30H
        
        define(this.opcodes, 0xF8, function() {
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            
            // Convert to signed offset
            const offset = (n & 0x80) ? n - 256 : n;
            
            const sp = this.registers.sp;
            const result = (sp + offset) & 0xFFFF;
            
            // Set flags
            this.setFlag('Z', false);
            this.setFlag('N', false);
            this.setFlag('H', ((sp ^ offset ^ result) & 0x10) !== 0);
            this.setFlag('C', ((sp ^ offset ^ result) & 0x100) !== 0);
            
            this.hl = result;
            return 12;
        }); // LD HL,SP+r8
        
        define(this.opcodes, 0xF9, function() {
            this.registers.sp = this.hl;
            return 8;
        }); // LD SP,HL
        
        define(this.opcodes, 0xFA, function() {
            const addr = this.readWord(this.registers.pc);
            this.registers.pc = (this.registers.pc + 2) & 0xFFFF;
            this.registers.a = this.readByte(addr);
            return 16;
        }); // LD A,(a16)
        
        define(this.opcodes, 0xFB, function() { this.pendingEnableInterrupts = true; return 4; }); // EI
        
        // 0xFC, 0xFD are illegal opcodes
        
        define(this.opcodes, 0xFE, function() { 
            const n = this.readByte(this.registers.pc++);
            this.registers.pc &= 0xFFFF;
            this.cp(n);
            return 8;
        }); // CP n
        
        define(this.opcodes, 0xFF, function() { 
            this.pushWord(this.registers.pc); 
            this.registers.pc = 0x38; 
            return 16; 
        }); // RST 38H
        
        // CB-prefixed instructions
        
        // Helper for defining CB instructions
        // CB Bit Manipulation Instructions
        // RLC (Rotate left with carry)
        for (let i = 0; i < 8; i++) {
            define(this.cbOpcodes, 0x00 + i, function() {
                this.rlc(i);
                return i === 6 ? 16 : 8;
            });
        }
        
        // RRC (Rotate right with carry)
        for (let i = 0; i < 8; i++) {
            define(this.cbOpcodes, 0x08 + i, function() {
                this.rrc(i);
                return i === 6 ? 16 : 8;
            });
        }
        
        // RL (Rotate left through carry)
        for (let i = 0; i < 8; i++) {
            define(this.cbOpcodes, 0x10 + i, function() {
                this.rl(i);
                return i === 6 ? 16 : 8;
            });
        }
        
        // RR (Rotate right through carry)
        for (let i = 0; i < 8; i++) {
            define(this.cbOpcodes, 0x18 + i, function() {
                this.rr(i);
                return i === 6 ? 16 : 8;
            });
        }
        
        // SLA (Shift left arithmetic)
        for (let i = 0; i < 8; i++) {
            define(this.cbOpcodes, 0x20 + i, function() {
                this.sla(i);
                return i === 6 ? 16 : 8;
            });
        }
        
        // SRA (Shift right arithmetic)
        for (let i = 0; i < 8; i++) {
            define(this.cbOpcodes, 0x28 + i, function() {
                this.sra(i);
                return i === 6 ? 16 : 8;
            });
        }
        
        // SWAP (Swap high and low nibbles)
        for (let i = 0; i < 8; i++) {
            define(this.cbOpcodes, 0x30 + i, function() {
                this.swap(i);
                return i === 6 ? 16 : 8;
            });
        }
        
        // SRL (Shift right logical)
        for (let i = 0; i < 8; i++) {
            define(this.cbOpcodes, 0x38 + i, function() {
                this.srl(i);
                return i === 6 ? 16 : 8;
            });
        }
        
        // BIT instructions
        for (let bit = 0; bit < 8; bit++) {
            for (let reg = 0; reg < 8; reg++) {
                define(this.cbOpcodes, 0x40 + (bit * 8) + reg, function() {
                    this.testBit(bit, reg);
                    return reg === 6 ? 16 : 8;
                });
            }
        }
        
        // RES instructions
        for (let bit = 0; bit < 8; bit++) {
            for (let reg = 0; reg < 8; reg++) {
                define(this.cbOpcodes, 0x80 + (bit * 8) + reg, function() {
                    this.resetBit(bit, reg);
                    return reg === 6 ? 16 : 8;
                });
            }
        }
        
        // SET instructions
        for (let bit = 0; bit < 8; bit++) {
            for (let reg = 0; reg < 8; reg++) {
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
    
    add16(value) {
        const hl = this.hl;
        const result = hl + value;
        
        this.setFlag('N', false);
        this.setFlag('H', ((hl & 0x0FFF) + (value & 0x0FFF)) > 0x0FFF);
        this.setFlag('C', result > 0xFFFF);
        
        this.hl = result & 0xFFFF;
    }
    
    adc(value) {
        const a = this.registers.a;
        const carry = this.getFlag('C') ? 1 : 0;
        const result = a + value + carry;
        
        this.setFlag('Z', (result & 0xFF) === 0);
        this.setFlag('N', false);
        this.setFlag('H', ((a & 0x0F) + (value & 0x0F) + carry) > 0x0F);
        this.setFlag('C', result > 0xFF);
        
        this.registers.a = result & 0xFF;
    }
    
    sub(value) {
        const a = this.registers.a;
        const result = a - value;
        
        this.setFlag('Z', (result & 0xFF) === 0);
        this.setFlag('N', true);
        this.setFlag('H', ((a & 0x0F) - (value & 0x0F)) < 0);
        this.setFlag('C', result < 0);
        
        this.registers.a = result & 0xFF;
    }
    
    sbc(value) {
        const a = this.registers.a;
        const carry = this.getFlag('C') ? 1 : 0;
        const result = a - value - carry;
        
        this.setFlag('Z', (result & 0xFF) === 0);
        this.setFlag('N', true);
        this.setFlag('H', ((a & 0x0F) - (value & 0x0F) - carry) < 0);
        this.setFlag('C', result < 0);
        
        this.registers.a = result & 0xFF;
    }
    
    and(value) {
        const result = this.registers.a & value;
        
        this.setFlag('Z', result === 0);
        this.setFlag('N', false);
        this.setFlag('H', true);
        this.setFlag('C', false);
        
        this.registers.a = result;
    }
    
    xor(value) {
        const result = this.registers.a ^ value;
        
        this.setFlag('Z', result === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', false);
        
        this.registers.a = result;
    }
    
    or(value) {
        const result = this.registers.a | value;
        
        this.setFlag('Z', result === 0);
        this.setFlag('N', false);
        this.setFlag('H', false);
        this.setFlag('C', false);
        
        this.registers.a = result;
    }
    
    cp(value) {
        const a = this.registers.a;
        const result = a - value;
        
        this.setFlag('Z', (result & 0xFF) === 0);
        this.setFlag('N', true);
        this.setFlag('H', ((a & 0x0F) - (value & 0x0F)) < 0);
        this.setFlag('C', result < 0);
    }
    
    inc8(regIndex) {
        const value = this.getRegisterValue(regIndex);
        const result = this.inc8Value(value);
        this.setRegisterValue(regIndex, result);
    }
    
    inc8Value(value) {
        const result = (value + 1) & 0xFF;
        
        this.setFlag('Z', result === 0);
        this.setFlag('N', false);
        this.setFlag('H', (value & 0x0F) === 0x0F);
        
        return result;
    }
    
    dec8(regIndex) {
        const value = this.getRegisterValue(regIndex);
        const result = this.dec8Value(value);
        this.setRegisterValue(regIndex, result);
    }
    
    dec8Value(value) {
        const result = (value - 1) & 0xFF;
        
        this.setFlag('Z', result === 0);
        this.setFlag('N', true);
        this.setFlag('H', (value & 0x0F) === 0);
        
        return result;
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