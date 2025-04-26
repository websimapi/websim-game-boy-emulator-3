export class PPU {
    constructor(mmu) {
        this.mmu = mmu;
        
        // Constants
        this.SCREEN_WIDTH = 160;
        this.SCREEN_HEIGHT = 144;
        this.TOTAL_LINES = 154;
        this.DOTS_PER_LINE = 456;
        this.MODE_HBLANK = 0;
        this.MODE_VBLANK = 1;
        this.MODE_OAM_SCAN = 2;
        this.MODE_PIXEL_TRANSFER = 3;
        
        // LCD state
        this.registers = {
            lcdc: 0x91, // 0xFF40 - LCD Control
            stat: 0x00, // 0xFF41 - LCD Status
            scy: 0x00,  // 0xFF42 - Scroll Y
            scx: 0x00,  // 0xFF43 - Scroll X
            ly: 0x00,   // 0xFF44 - Current line (Y-coordinate)
            lyc: 0x00,  // 0xFF45 - LY Compare
            bgp: 0xFC,  // 0xFF47 - BG Palette Data
            obp0: 0xFF, // 0xFF48 - Object Palette 0 Data
            obp1: 0xFF, // 0xFF49 - Object Palette 1 Data
            wy: 0x00,   // 0xFF4A - Window Y Position
            wx: 0x00    // 0xFF4B - Window X Position minus 7
        };
        
        // PPU state
        this.mode = this.MODE_OAM_SCAN;
        this.dotCounter = 0;
        this.frameReady = false;
        
        // Canvas and context for rendering
        this.canvas = document.getElementById('screen');
        this.ctx = this.canvas.getContext('2d');
        this.imageData = this.ctx.createImageData(this.SCREEN_WIDTH, this.SCREEN_HEIGHT);
        this.frameBuffer = new Uint32Array(this.imageData.data.buffer);
        
        // Colors (GB green palette)
        this.colors = [
            0xFF9BBC0F, // Lightest
            0xFF8BAC0F, // Light
            0xFF306230, // Dark
            0xFF0F380F  // Darkest
        ];
        
        this.reset();
    }
    
    reset() {
        // Reset registers to post-boot values
        this.registers.lcdc = 0x91;
        this.registers.stat = 0x00;
        this.registers.scy = 0x00;
        this.registers.scx = 0x00;
        this.registers.ly = 0x00;
        this.registers.lyc = 0x00;
        this.registers.bgp = 0xFC;
        this.registers.obp0 = 0xFF;
        this.registers.obp1 = 0xFF;
        this.registers.wy = 0x00;
        this.registers.wx = 0x00;
        
        // Reset PPU state
        this.mode = this.MODE_OAM_SCAN;
        this.dotCounter = 0;
        this.frameReady = false;
        
        // Clear frame buffer
        this.frameBuffer.fill(this.colors[0]);
    }
    
    // Check if LCD is enabled
    isLCDEnabled() {
        return (this.registers.lcdc & 0x80) !== 0;
    }
    
    // Check if background is enabled
    isBackgroundEnabled() {
        return (this.registers.lcdc & 0x01) !== 0;
    }
    
    // Check if window is enabled
    isWindowEnabled() {
        return (this.registers.lcdc & 0x20) !== 0 && (this.registers.wx <= 166);
    }
    
    // Check if sprites are enabled
    areSpritesEnabled() {
        return (this.registers.lcdc & 0x02) !== 0;
    }
    
    // Get sprite size (8x8 or 8x16)
    getSpriteSize() {
        return (this.registers.lcdc & 0x04) !== 0 ? 16 : 8;
    }
    
    // Get background tile map address
    getBackgroundTileMapAddress() {
        return (this.registers.lcdc & 0x08) !== 0 ? 0x9C00 : 0x9800;
    }
    
    // Get window tile map address
    getWindowTileMapAddress() {
        return (this.registers.lcdc & 0x40) !== 0 ? 0x9C00 : 0x9800;
    }
    
    // Get tile data address
    getTileDataAddress() {
        return (this.registers.lcdc & 0x10) !== 0 ? 0x8000 : 0x8800;
    }
    
    // Check if using signed addressing mode for tiles
    isUsingSignedAddressing() {
        return (this.registers.lcdc & 0x10) === 0;
    }
    
    // Check if VRAM is accessible by CPU
    isVRAMAccessible() {
        return this.mode !== this.MODE_PIXEL_TRANSFER;
    }
    
    // Check if OAM is accessible by CPU
    isOAMAccessible() {
        return this.mode !== this.MODE_OAM_SCAN && this.mode !== this.MODE_PIXEL_TRANSFER;
    }
    
    // Read PPU register
    readRegister(address) {
        switch (address) {
            case 0xFF40: return this.registers.lcdc;
            case 0xFF41:
                // Combine mode and STAT flags
                return this.registers.stat | (this.mode & 0x03) | (this.registers.ly === this.registers.lyc ? 0x04 : 0x00) | 0x80;
            case 0xFF42: return this.registers.scy;
            case 0xFF43: return this.registers.scx;
            case 0xFF44: return this.registers.ly;
            case 0xFF45: return this.registers.lyc;
            case 0xFF47: return this.registers.bgp;
            case 0xFF48: return this.registers.obp0;
            case 0xFF49: return this.registers.obp1;
            case 0xFF4A: return this.registers.wy;
            case 0xFF4B: return this.registers.wx;
            default: return 0xFF;
        }
    }
    
    // Write to PPU register
    writeRegister(address, value) {
        switch (address) {
            case 0xFF40:
                // If LCD is being turned off, reset PPU
                if ((this.registers.lcdc & 0x80) && !(value & 0x80)) {
                    this.registers.ly = 0;
                    this.dotCounter = 0;
                    this.mode = this.MODE_HBLANK;
                    this.registers.stat &= ~0x03;
                }
                this.registers.lcdc = value;
                break;
            case 0xFF41:
                // Only bits 3-6 are writable
                this.registers.stat = (value & 0x78) | (this.registers.stat & 0x07);
                // Check for LYC=LY STAT interrupt
                this.checkLYCEqualLY();
                break;
            case 0xFF42: this.registers.scy = value; break;
            case 0xFF43: this.registers.scx = value; break;
            case 0xFF44: /* LY is read-only */ break;
            case 0xFF45:
                this.registers.lyc = value;
                // Check for LYC=LY STAT interrupt
                this.checkLYCEqualLY();
                break;
            case 0xFF47: this.registers.bgp = value; break;
            case 0xFF48: this.registers.obp0 = value; break;
            case 0xFF49: this.registers.obp1 = value; break;
            case 0xFF4A: this.registers.wy = value; break;
            case 0xFF4B: this.registers.wx = value; break;
        }
    }
    
    // Check LYC=LY and request STAT interrupt if needed
    checkLYCEqualLY() {
        const lyEqualsLyc = this.registers.ly === this.registers.lyc;
        
        // Set/clear bit 2 of STAT register
        if (lyEqualsLyc) {
            this.registers.stat |= 0x04;
        } else {
            this.registers.stat &= ~0x04;
        }
        
        // Request STAT interrupt if LYC=LY flag is set in STAT (bit 6)
        if (lyEqualsLyc && (this.registers.stat & 0x40)) {
            this.requestSTATInterrupt();
        }
    }
    
    // Request STAT interrupt
    requestSTATInterrupt() {
        // Set bit 1 of IF register
        const ifReg = this.mmu.readByte(0xFF0F);
        this.mmu.writeByte(0xFF0F, ifReg | 0x02);
    }
    
    // Request VBLANK interrupt
    requestVBlankInterrupt() {
        // Set bit 0 of IF register
        const ifReg = this.mmu.readByte(0xFF0F);
        this.mmu.writeByte(0xFF0F, ifReg | 0x01);
    }
    
    // Step the PPU forward by the given number of dots (T-cycles)
    step(cycles) {
        if (!this.isLCDEnabled()) {
            return;
        }
        
        this.dotCounter += cycles;
        
        // Process whole scanlines
        while (this.dotCounter >= this.DOTS_PER_LINE) {
            this.dotCounter -= this.DOTS_PER_LINE;
            this.registers.ly = (this.registers.ly + 1) % this.TOTAL_LINES;
            
            this.checkLYCEqualLY();
            
            // Check for mode changes
            if (this.registers.ly >= this.SCREEN_HEIGHT) {
                // VBlank (lines 144-153)
                if (this.mode !== this.MODE_VBLANK) {
                    this.mode = this.MODE_VBLANK;
                    this.requestVBlankInterrupt();
                    
                    // Set mode flag in STAT register
                    this.registers.stat = (this.registers.stat & ~0x03) | this.mode;
                    
                    // Request STAT interrupt if VBlank flag is set in STAT (bit 4)
                    if (this.registers.stat & 0x10) {
                        this.requestSTATInterrupt();
                    }
                    
                    // Set flag to render the frame
                    this.frameReady = true;
                }
            } else {
                // New visible scanline
                this.mode = this.MODE_OAM_SCAN;
                
                // Set mode flag in STAT register
                this.registers.stat = (this.registers.stat & ~0x03) | this.mode;
                
                // Request STAT interrupt if OAM flag is set in STAT (bit 5)
                if (this.registers.stat & 0x20) {
                    this.requestSTATInterrupt();
                }
            }
        }
        
        // Process within a scanline
        if (this.registers.ly < this.SCREEN_HEIGHT) {
            const scanlineDots = this.dotCounter;
            
            if (scanlineDots <= 80) {
                // Mode 2: OAM Scan (80 dots)
                if (this.mode !== this.MODE_OAM_SCAN) {
                    this.mode = this.MODE_OAM_SCAN;
                    
                    // Set mode flag in STAT register
                    this.registers.stat = (this.registers.stat & ~0x03) | this.mode;
                    
                    // Request STAT interrupt if OAM flag is set in STAT (bit 5)
                    if (this.registers.stat & 0x20) {
                        this.requestSTATInterrupt();
                    }
                }
            } else if (scanlineDots <= 80 + 172) {
                // Mode 3: Pixel Transfer (172+ dots)
                if (this.mode !== this.MODE_PIXEL_TRANSFER) {
                    this.mode = this.MODE_PIXEL_TRANSFER;
                    
                    // Set mode flag in STAT register
                    this.registers.stat = (this.registers.stat & ~0x03) | this.mode;
                    
                    // Render scanline
                    this.renderScanline();
                }
            } else {
                // Mode 0: HBlank (rest of the 456 dots)
                if (this.mode !== this.MODE_HBLANK) {
                    this.mode = this.MODE_HBLANK;
                    
                    // Set mode flag in STAT register
                    this.registers.stat = (this.registers.stat & ~0x03) | this.mode;
                    
                    // Request STAT interrupt if HBlank flag is set in STAT (bit 3)
                    if (this.registers.stat & 0x08) {
                        this.requestSTATInterrupt();
                    }
                }
            }
        }
    }
    
    // Render a single scanline to the frame buffer
    renderScanline() {
        const y = this.registers.ly;
        
        if (y >= this.SCREEN_HEIGHT) {
            return;
        }
        
        // Render background
        if (this.isBackgroundEnabled()) {
            this.renderBackground(y);
        } else {
            // If background is disabled, fill with white (color 0)
            for (let x = 0; x < this.SCREEN_WIDTH; x++) {
                this.frameBuffer[y * this.SCREEN_WIDTH + x] = this.colors[0];
            }
        }
        
        // Render window
        if (this.isWindowEnabled() && this.registers.wy <= y) {
            this.renderWindow(y);
        }
        
        // Render sprites
        if (this.areSpritesEnabled()) {
            this.renderSprites(y);
        }
    }
    
    // Render the background for a scanline
    renderBackground(y) {
        const tileMapAddress = this.getBackgroundTileMapAddress();
        const tileDataAddress = this.getTileDataAddress();
        const usingSignedAddressing = this.isUsingSignedAddressing();
        
        const yWithScroll = (y + this.registers.scy) & 0xFF;
        const tileRow = Math.floor(yWithScroll / 8);
        const tileY = yWithScroll % 8;
        
        for (let x = 0; x < this.SCREEN_WIDTH; x++) {
            const xWithScroll = (x + this.registers.scx) & 0xFF;
            const tileCol = Math.floor(xWithScroll / 8);
            const tileX = xWithScroll % 8;
            
            // Get tile number from tile map
            const tileMapOffset = tileRow * 32 + tileCol;
            const tileNum = this.mmu.readByte(tileMapAddress + tileMapOffset);
            
            // Get tile data address
            let tileAddress;
            if (usingSignedAddressing) {
                // Unsigned addressing mode ($8800-$97FF, with $9000 as base, using signed tile numbers)
                tileAddress = tileDataAddress + ((tileNum << 24) >> 24) * 16;
            } else {
                // Unsigned addressing mode ($8000-$8FFF, using unsigned tile numbers)
                tileAddress = tileDataAddress + tileNum * 16;
            }
            
            // Get the tile line data (2 bytes per line, 8 pixels)
            const tileLowByte = this.mmu.readByte(tileAddress + tileY * 2);
            const tileHighByte = this.mmu.readByte(tileAddress + tileY * 2 + 1);
            
            // Extract the color id for this pixel (bit 7-x from both bytes)
            const colorBit = 7 - tileX;
            const colorId = ((tileHighByte >> colorBit) & 1) << 1 | ((tileLowByte >> colorBit) & 1);
            
            // Apply background palette
            const paletteColor = (this.registers.bgp >> (colorId * 2)) & 0x03;
            
            // Set pixel in frame buffer
            this.frameBuffer[y * this.SCREEN_WIDTH + x] = this.colors[paletteColor];
        }
    }
    
    // Render the window for a scanline
    renderWindow(y) {
        if (this.registers.wx >= 7 + this.SCREEN_WIDTH) {
            return; // Window is off-screen
        }
        
        const tileMapAddress = this.getWindowTileMapAddress();
        const tileDataAddress = this.getTileDataAddress();
        const usingSignedAddressing = this.isUsingSignedAddressing();
        
        const windowY = y - this.registers.wy;
        if (windowY < 0) {
            return; // Window not visible on this line
        }
        
        const tileRow = Math.floor(windowY / 8);
        const tileY = windowY % 8;
        
        for (let x = 0; x < this.SCREEN_WIDTH; x++) {
            const windowX = x - (this.registers.wx - 7);
            if (windowX < 0) {
                continue; // Window not visible at this X position
            }
            
            const tileCol = Math.floor(windowX / 8);
            const tileX = windowX % 8;
            
            // Get tile number from tile map
            const tileMapOffset = tileRow * 32 + tileCol;
            const tileNum = this.mmu.readByte(tileMapAddress + tileMapOffset);
            
            // Get tile data address
            let tileAddress;
            if (usingSignedAddressing) {
                // Unsigned addressing mode ($8800-$97FF, with $9000 as base, using signed tile numbers)
                tileAddress = tileDataAddress + ((tileNum << 24) >> 24) * 16;
            } else {
                // Unsigned addressing mode ($8000-$8FFF, using unsigned tile numbers)
                tileAddress = tileDataAddress + tileNum * 16;
            }
            
            // Get the tile line data (2 bytes per line, 8 pixels)
            const tileLowByte = this.mmu.readByte(tileAddress + tileY * 2);
            const tileHighByte = this.mmu.readByte(tileAddress + tileY * 2 + 1);
            
            // Extract the color id for this pixel (bit 7-x from both bytes)
            const colorBit = 7 - tileX;
            const colorId = ((tileHighByte >> colorBit) & 1) << 1 | ((tileLowByte >> colorBit) & 1);
            
            // Apply background palette
            const paletteColor = (this.registers.bgp >> (colorId * 2)) & 0x03;
            
            // Set pixel in frame buffer
            this.frameBuffer[y * this.SCREEN_WIDTH + x] = this.colors[paletteColor];
        }
    }
    
    // Render sprites for a scanline
    renderSprites(y) {
        const sprites = [];
        const spriteSize = this.getSpriteSize();
        const maxSpritesPerLine = 10; // Hardware limit
        
        // Gather sprites for this scanline
        for (let i = 0; i < 40; i++) {
            const spriteY = this.mmu.readByte(0xFE00 + i * 4) - 16;
            
            // Check if sprite is on this scanline
            if (y >= spriteY && y < spriteY + spriteSize) {
                sprites.push({
                    y: spriteY,
                    x: this.mmu.readByte(0xFE00 + i * 4 + 1) - 8,
                    tileNum: this.mmu.readByte(0xFE00 + i * 4 + 2) & (spriteSize === 16 ? 0xFE : 0xFF), // For 8x16, bit 0 is ignored
                    attributes: this.mmu.readByte(0xFE00 + i * 4 + 3),
                    index: i
                });
                
                if (sprites.length >= maxSpritesPerLine) {
                    break;
                }
            }
        }
        
        // Sort sprites by X coordinate (lower X has priority)
        // If X is the same, lower OAM index has priority
        sprites.sort((a, b) => {
            if (a.x === b.x) {
                return a.index - b.index;
            }
            return a.x - b.x;
        });
        
        // Render sprites (in reverse order so higher priority sprites are drawn on top)
        for (let i = sprites.length - 1; i >= 0; i--) {
            const sprite = sprites[i];
            
            // Calculate Y offset within sprite
            let tileY = y - sprite.y;
            
            // Y flip
            if (sprite.attributes & 0x40) {
                tileY = spriteSize - 1 - tileY;
            }
            
            // For 8x16 sprites, select top or bottom tile
            const tileNum = spriteSize === 16 
                ? (sprite.tileNum & 0xFE) + (tileY >= 8 ? 1 : 0)
                : sprite.tileNum;
                
            // Adjust Y offset for bottom tile in 8x16 mode
            if (spriteSize === 16 && tileY >= 8) {
                tileY -= 8;
            }
            
            // Get tile data address
            const tileAddress = 0x8000 + tileNum * 16 + tileY * 2;
            
            // Read tile line data
            const tileLowByte = this.mmu.readByte(tileAddress);
            const tileHighByte = this.mmu.readByte(tileAddress + 1);
            
            // Get the palette to use
            const palette = (sprite.attributes & 0x10) ? this.registers.obp1 : this.registers.obp0;
            
            // Render sprite pixels
            for (let tileX = 0; tileX < 8; tileX++) {
                // Skip if pixel is off-screen
                const pixelX = sprite.x + (sprite.attributes & 0x20 ? 7 - tileX : tileX);
                if (pixelX < 0 || pixelX >= this.SCREEN_WIDTH) {
                    continue;
                }
                
                // Extract the color id
                const colorBit = 7 - (sprite.attributes & 0x20 ? 7 - tileX : tileX);
                const colorId = ((tileHighByte >> colorBit) & 1) << 1 | ((tileLowByte >> colorBit) & 1);
                
                // Skip transparent pixels
                if (colorId === 0) {
                    continue;
                }
                
                // Check if sprite is behind background
                if (sprite.attributes & 0x80) {
                    // Check if background pixel is non-zero
                    const bgPixelColor = this.frameBuffer[y * this.SCREEN_WIDTH + pixelX];
                    if (bgPixelColor !== this.colors[0]) {
                        continue;
                    }
                }
                
                // Apply sprite palette
                const paletteColor = (palette >> (colorId * 2)) & 0x03;
                
                // Set pixel in frame buffer
                this.frameBuffer[y * this.SCREEN_WIDTH + pixelX] = this.colors[paletteColor];
            }
        }
    }
    
    // Render the current frame to the canvas
    renderFrame() {
        if (this.frameReady) {
            this.ctx.putImageData(this.imageData, 0, 0);
            this.frameReady = false;
        }
    }
}

