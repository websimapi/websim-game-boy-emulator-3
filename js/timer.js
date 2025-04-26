export class Timer {
    constructor(mmu) {
        this.mmu = mmu;
        
        // Timer registers
        this.div = 0;   // Divider register (0xFF04)
        this.tima = 0;  // Timer counter (0xFF05)
        this.tma = 0;   // Timer modulo (0xFF06)
        this.tac = 0;   // Timer control (0xFF07)
        
        // Internal counters
        this.divCounter = 0;
        this.timaCounter = 0;
        
        // Frequencies
        this.timaFrequencies = [1024, 16, 64, 256]; // Hz
        
        this.reset();
    }
    
    reset() {
        this.div = 0xAB;  // DMG boot value
        this.tima = 0;
        this.tma = 0;
        this.tac = 0xF8;  // Upper bits are unused and read 1
        
        this.divCounter = 0;
        this.timaCounter = 0;
    }
    
    // Read timer registers
    readDIV() {
        return this.div;
    }
    
    readTIMA() {
        return this.tima;
    }
    
    readTMA() {
        return this.tma;
    }
    
    readTAC() {
        return this.tac | 0xF8; // Upper bits always read as 1
    }
    
    // Write timer registers
    resetDIV() {
        this.div = 0;
        this.divCounter = 0;
    }
    
    writeTIMA(value) {
        this.tima = value;
    }
    
    writeTMA(value) {
        this.tma = value;
    }
    
    writeTAC(value) {
        this.tac = value;
    }
    
    // Check if timer is enabled
    isTimerEnabled() {
        return (this.tac & 0x04) !== 0;
    }
    
    // Get timer frequency
    getTimerFrequency() {
        return this.timaFrequencies[this.tac & 0x03];
    }
    
    // Request timer interrupt
    requestInterrupt() {
        // Set bit 2 of IF register
        const ifReg = this.mmu.readByte(0xFF0F);
        this.mmu.writeByte(0xFF0F, ifReg | 0x04);
    }
    
    // Step timer by the given number of cycles
    step(cycles) {
        // Update DIV register (increments at 16384Hz, once every 256 cycles)
        this.divCounter += cycles;
        while (this.divCounter >= 256) {
            this.divCounter -= 256;
            this.div = (this.div + 1) & 0xFF;
        }
        
        // Update TIMA if timer is enabled
        if (this.isTimerEnabled()) {
            // Calculate cycles per increment for the current frequency
            const cyclesPerIncrement = 4194304 / this.getTimerFrequency();
            
            this.timaCounter += cycles;
            while (this.timaCounter >= cyclesPerIncrement) {
                this.timaCounter -= cyclesPerIncrement;
                
                // Increment TIMA
                this.tima = (this.tima + 1) & 0xFF;
                
                // Check for TIMA overflow
                if (this.tima === 0) {
                    // Reset TIMA to TMA
                    this.tima = this.tma;
                    
                    // Request timer interrupt
                    this.requestInterrupt();
                }
            }
        }
    }
}

