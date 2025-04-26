export class Input {
    constructor(mmu) {
        this.mmu = mmu;
        
        // Button states (true = pressed)
        this.buttons = {
            up: false,
            right: false,
            down: false,
            left: false,
            a: false,
            b: false,
            select: false,
            start: false
        };
        
        // JOYP register (0xFF00)
        this.joyp = 0xCF; // Initial value
        
        // Selected button group
        this.selectDpad = false;    // Bit 4 = 0: Select D-pad
        this.selectButtons = false; // Bit 5 = 0: Select buttons
    }
    
    reset() {
        // Reset button states
        this.buttons.up = false;
        this.buttons.right = false;
        this.buttons.down = false;
        this.buttons.left = false;
        this.buttons.a = false;
        this.buttons.b = false;
        this.buttons.select = false;
        this.buttons.start = false;
        
        // Reset JOYP
        this.joyp = 0xCF;
        this.selectDpad = false;
        this.selectButtons = false;
    }
    
    // Read JOYP register
    readJOYP() {
        // Calculate current state
        let value = this.joyp & 0xF0; // Preserve the upper 4 bits
        
        // If both selects are high, return all 1s for buttons (no buttons pressed)
        if (!this.selectDpad && !this.selectButtons) {
            return value | 0x0F;
        }
        
        // If D-pad is selected (bit 4 = 0)
        if (this.selectDpad) {
            value |= (this.buttons.down ? 0 : 1) << 3;
            value |= (this.buttons.up ? 0 : 1) << 2;
            value |= (this.buttons.left ? 0 : 1) << 1;
            value |= (this.buttons.right ? 0 : 1);
        }
        
        // If buttons are selected (bit 5 = 0)
        if (this.selectButtons) {
            value |= (this.buttons.start ? 0 : 1) << 3;
            value |= (this.buttons.select ? 0 : 1) << 2;
            value |= (this.buttons.b ? 0 : 1) << 1;
            value |= (this.buttons.a ? 0 : 1);
        }
        
        return value;
    }
    
    // Write to JOYP register
    writeJOYP(value) {
        // Only bits 4-5 are writable
        this.joyp = (value & 0x30) | (this.joyp & 0xCF);
        
        // Update selected button groups
        this.selectDpad = (value & 0x10) === 0;
        this.selectButtons = (value & 0x20) === 0;
    }
    
    // Set a button state and request interrupt if needed
    setButton(buttonIndex, pressed) {
        let changed = false;
        
        switch (buttonIndex) {
            case 0: // Up
                changed = this.buttons.up !== pressed;
                this.buttons.up = pressed;
                break;
            case 1: // Right
                changed = this.buttons.right !== pressed;
                this.buttons.right = pressed;
                break;
            case 2: // Down
                changed = this.buttons.down !== pressed;
                this.buttons.down = pressed;
                break;
            case 3: // Left
                changed = this.buttons.left !== pressed;
                this.buttons.left = pressed;
                break;
            case 4: // A
                changed = this.buttons.a !== pressed;
                this.buttons.a = pressed;
                break;
            case 5: // B
                changed = this.buttons.b !== pressed;
                this.buttons.b = pressed;
                break;
            case 6: // Select
                changed = this.buttons.select !== pressed;
                this.buttons.select = pressed;
                break;
            case 7: // Start
                changed = this.buttons.start !== pressed;
                this.buttons.start = pressed;
                break;
        }
        
        // If a button changed state and it was pressed, request interrupt
        if (changed && pressed) {
            this.requestInterrupt();
        }
    }
    
    // Handle keyboard events
    handleKeyDown(event) {
        // Prevent default actions for game keys
        if (this.isGameKey(event.code)) {
            event.preventDefault();
        }
        
        switch (event.code) {
            case 'ArrowUp':
                this.setButton(0, true); // Up
                break;
            case 'ArrowRight':
                this.setButton(1, true); // Right
                break;
            case 'ArrowDown':
                this.setButton(2, true); // Down
                break;
            case 'ArrowLeft':
                this.setButton(3, true); // Left
                break;
            case 'KeyZ':
                this.setButton(4, true); // A
                break;
            case 'KeyX':
                this.setButton(5, true); // B
                break;
            case 'ShiftRight':
            case 'ShiftLeft':
                this.setButton(6, true); // Select
                break;
            case 'Enter':
                this.setButton(7, true); // Start
                break;
        }
    }
    
    handleKeyUp(event) {
        switch (event.code) {
            case 'ArrowUp':
                this.setButton(0, false); // Up
                break;
            case 'ArrowRight':
                this.setButton(1, false); // Right
                break;
            case 'ArrowDown':
                this.setButton(2, false); // Down
                break;
            case 'ArrowLeft':
                this.setButton(3, false); // Left
                break;
            case 'KeyZ':
                this.setButton(4, false); // A
                break;
            case 'KeyX':
                this.setButton(5, false); // B
                break;
            case 'ShiftRight':
            case 'ShiftLeft':
                this.setButton(6, false); // Select
                break;
            case 'Enter':
                this.setButton(7, false); // Start
                break;
        }
    }
    
    isGameKey(keyCode) {
        return ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'KeyZ', 'KeyX', 'ShiftRight', 'ShiftLeft', 'Enter'].includes(keyCode);
    }
    
    // Request joypad interrupt
    requestInterrupt() {
        // Set bit 4 of IF register
        const ifReg = this.mmu.readByte(0xFF0F);
        this.mmu.writeByte(0xFF0F, ifReg | 0x10);
    }
}

