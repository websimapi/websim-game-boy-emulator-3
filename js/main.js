import { CPU } from './cpu.js';
import { MMU } from './mmu.js';
import { PPU } from './ppu.js';
import { APU } from './apu.js';
import { Input } from './input.js';
import { Timer } from './timer.js';
import { Cartridge } from './cartridge.js';

class GameBoy {
    constructor() {
        this.mmu = new MMU();
        this.cpu = new CPU(this.mmu);
        this.ppu = new PPU(this.mmu);
        this.apu = new APU(this.mmu);
        this.input = new Input(this.mmu);
        this.timer = new Timer(this.mmu);
        
        this.isRunning = false;
        this.isPaused = false;
        this.frameTime = 1000 / 60; // ~60fps
        this.lastFrameTime = 0;
        this.cyclesPerFrame = 70224; // Number of cycles per frame (~59.7Hz)
        
        this.debug = false;
        
        // Connect components
        this.mmu.connectComponents(this.cpu, this.ppu, this.apu, this.timer, this.input);
    }
    
    loadROM(romData) {
        const cartridge = new Cartridge(romData);
        this.mmu.loadCartridge(cartridge);
        
        // Reset all components
        this.cpu.reset();
        this.ppu.reset();
        this.apu.reset();
        this.timer.reset();
        
        return cartridge.getInfo();
    }
    
    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.isPaused = false;
            this.run();
            
            // Start audio
            this.apu.start();
        } else if (this.isPaused) {
            this.isPaused = false;
            this.apu.resume();
        }
    }
    
    pause() {
        this.isPaused = true;
        this.apu.pause();
    }
    
    stop() {
        this.isRunning = false;
        this.isPaused = false;
        this.apu.stop();
    }
    
    run() {
        if (!this.isRunning) return;
        
        const runFrame = (timestamp) => {
            if (!this.isRunning) return;
            if (this.isPaused) {
                requestAnimationFrame(runFrame);
                return;
            }
            
            // Calculate elapsed time since last frame
            const elapsed = timestamp - this.lastFrameTime;
            
            if (elapsed >= this.frameTime) {
                this.lastFrameTime = timestamp - (elapsed % this.frameTime);
                
                // Execute one frame worth of instructions
                let cycles = 0;
                while (cycles < this.cyclesPerFrame) {
                    const cpuCycles = this.cpu.step();
                    cycles += cpuCycles;
                    
                    // Update PPU
                    this.ppu.step(cpuCycles);
                    
                    // Update Timer
                    this.timer.step(cpuCycles);
                    
                    // Update APU
                    this.apu.step(cpuCycles);
                }
                
                // Render the frame
                this.ppu.renderFrame();
                
                if (this.debug) {
                    this.debugInfo();
                }
            }
            
            requestAnimationFrame(runFrame);
        };
        
        requestAnimationFrame(runFrame);
    }
    
    debugInfo() {
        const cpu = this.cpu;
        const debugDiv = document.getElementById('debug');
        debugDiv.textContent = `A: ${cpu.registers.a.toString(16).padStart(2, '0')} ` +
                              `F: ${cpu.registers.f.toString(16).padStart(2, '0')} ` +
                              `B: ${cpu.registers.b.toString(16).padStart(2, '0')} ` +
                              `C: ${cpu.registers.c.toString(16).padStart(2, '0')} ` +
                              `D: ${cpu.registers.d.toString(16).padStart(2, '0')} ` +
                              `E: ${cpu.registers.e.toString(16).padStart(2, '0')} ` +
                              `H: ${cpu.registers.h.toString(16).padStart(2, '0')} ` +
                              `L: ${cpu.registers.l.toString(16).padStart(2, '0')} ` +
                              `SP: ${cpu.registers.sp.toString(16).padStart(4, '0')} ` +
                              `PC: ${cpu.registers.pc.toString(16).padStart(4, '0')} ` +
                              `Z:${cpu.getFlag('Z') ? 1 : 0} ` +
                              `N:${cpu.getFlag('N') ? 1 : 0} ` +
                              `H:${cpu.getFlag('H') ? 1 : 0} ` +
                              `C:${cpu.getFlag('C') ? 1 : 0}`;
    }
}

// Initialize the emulator
const gameboy = new GameBoy();

// Set up ROM loading
const romInput = document.getElementById('rom-input');
const dropArea = document.getElementById('drop-area');
const romInfo = document.getElementById('rom-info');
const romDetails = document.getElementById('rom-details');

// File input change handler
romInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        loadROMFile(file);
    }
});

// Drag and drop handlers
dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.style.backgroundColor = '#e6e6e6';
});

dropArea.addEventListener('dragleave', () => {
    dropArea.style.backgroundColor = '#f9f9f9';
});

dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.style.backgroundColor = '#f9f9f9';
    
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.gb')) {
        loadROMFile(file);
    } else {
        alert('Please drop a valid Game Boy ROM file (.gb)');
    }
});

function loadROMFile(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const romData = new Uint8Array(e.target.result);
        try {
            const info = gameboy.loadROM(romData);
            
            // Display ROM info
            romInfo.style.display = 'block';
            romDetails.innerHTML = `
                <p><strong>Title:</strong> ${info.title}</p>
                <p><strong>Type:</strong> ${info.cartridgeType}</p>
                <p><strong>ROM Size:</strong> ${info.romSize}</p>
                <p><strong>RAM Size:</strong> ${info.ramSize}</p>
            `;
            
            // Start emulation
            gameboy.start();
            
            // Update UI
            dropArea.style.display = 'none';
        } catch (error) {
            console.error('Error loading ROM:', error);
            alert(`Error loading ROM: ${error.message}`);
        }
    };
    
    reader.onerror = () => {
        alert('Error reading the file');
    };
    
    reader.readAsArrayBuffer(file);
}

// Set up keyboard input
document.addEventListener('keydown', (e) => {
    gameboy.input.handleKeyDown(e);
});

document.addEventListener('keyup', (e) => {
    gameboy.input.handleKeyUp(e);
});

// Set up button input
const buttons = {
    'up': 0,
    'right': 1,
    'down': 2,
    'left': 3,
    'a': 4,
    'b': 5,
    'select': 6,
    'start': 7
};

for (const [id, index] of Object.entries(buttons)) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('mousedown', () => gameboy.input.setButton(index, true));
        element.addEventListener('mouseup', () => gameboy.input.setButton(index, false));
        element.addEventListener('touchstart', (e) => {
            e.preventDefault();
            gameboy.input.setButton(index, true);
        });
        element.addEventListener('touchend', (e) => {
            e.preventDefault();
            gameboy.input.setButton(index, false);
        });
    }
}

// Export gameboy instance for debugging
window.gameboy = gameboy;

