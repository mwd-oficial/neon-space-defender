/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Zap, Timer, Target, Play, Shield, Volume2, VolumeX } from 'lucide-react';

// --- Constants & Types ---

type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

interface GameState {
  score: number;
  lives: number;
  ammo: number;
  timeLeft: number;
  level: number;
  difficulty: Difficulty;
  isGameOver: boolean;
  isPaused: boolean;
  hasStarted: boolean;
}

interface Entity {
  x: number;
  y: number;
  width: number;
  height: number;
  speedX: number;
  speedY: number;
  color: string;
}

interface Player extends Entity {
  isInvulnerable: boolean;
  invulnerabilityTimer: number;
}

interface Enemy extends Entity {
  type: 'basic' | 'fast' | 'tank';
  health: number;
}

interface Bullet extends Entity {
  damage: number;
}

interface PowerUp extends Entity {
  type: 'life' | 'ammo';
}

const DIFFICULTY_CONFIG = {
  EASY: {
    initialAmmo: 100,
    initialTime: 120,
    enemySpeedMult: 1,
    spawnRate: 0.02,
    layoutColor: '#00ff88',
  },
  MEDIUM: {
    initialAmmo: 60,
    initialTime: 90,
    enemySpeedMult: 1.5,
    spawnRate: 0.04,
    layoutColor: '#00d4ff',
  },
  HARD: {
    initialAmmo: 30,
    initialTime: 60,
    enemySpeedMult: 2.2,
    spawnRate: 0.07,
    layoutColor: '#ff0055',
  },
};

// --- Audio Engine (Synthesized) ---

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterVolume: GainNode | null = null;
  private isMuted: boolean = false;

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterVolume = this.ctx.createGain();
    this.masterVolume.connect(this.ctx.destination);
    this.masterVolume.gain.value = 0.3;
  }

  setMute(mute: boolean) {
    this.isMuted = mute;
    if (this.masterVolume) {
      this.masterVolume.gain.value = mute ? 0 : 0.3;
    }
  }

  playShoot() {
    if (!this.ctx || !this.masterVolume || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.masterVolume);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }

  playExplosion() {
    if (!this.ctx || !this.masterVolume || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.masterVolume);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  playPowerUp() {
    if (!this.ctx || !this.masterVolume || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.masterVolume);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }
}

const sounds = new SoundEngine();

// --- Main Component ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    lives: 3,
    ammo: 100,
    timeLeft: 120,
    level: 1,
    difficulty: 'EASY',
    isGameOver: false,
    isPaused: false,
    hasStarted: false,
  });
  const [isMuted, setIsMuted] = useState(false);

  // Refs for game loop to avoid closure issues
  const playerRef = useRef<Player>({
    x: 50,
    y: 300,
    width: 40,
    height: 30,
    speedX: 0,
    speedY: 0,
    color: '#00ffcc',
    isInvulnerable: false,
    invulnerabilityTimer: 0,
  });
  const enemiesRef = useRef<Enemy[]>([]);
  const bulletsRef = useRef<Bullet[]>([]);
  const powerUpsRef = useRef<PowerUp[]>([]);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const lastShotTimeRef = useRef<number>(0);
  const gameTimeRef = useRef<number>(0);

  const startGame = (difficulty: Difficulty) => {
    sounds.init();
    const config = DIFFICULTY_CONFIG[difficulty];
    setGameState({
      score: 0,
      lives: 3,
      ammo: config.initialAmmo,
      timeLeft: config.initialTime,
      level: 1,
      difficulty,
      isGameOver: false,
      isPaused: false,
      hasStarted: true,
    });
    playerRef.current = {
      x: 50,
      y: 300,
      width: 40,
      height: 30,
      speedX: 0,
      speedY: 0,
      color: '#00ffcc',
      isInvulnerable: false,
      invulnerabilityTimer: 0,
    };
    enemiesRef.current = [];
    bulletsRef.current = [];
    powerUpsRef.current = [];
    gameTimeRef.current = Date.now();
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    sounds.setMute(!isMuted);
  };

  // Game Loop
  useEffect(() => {
    if (!gameState.hasStarted || gameState.isGameOver || gameState.isPaused) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const update = () => {
      const config = DIFFICULTY_CONFIG[gameState.difficulty];
      
      // 1. Timer Logic
      const now = Date.now();
      if (now - gameTimeRef.current >= 1000) {
        setGameState(prev => {
          if (prev.timeLeft <= 1) {
            return { ...prev, timeLeft: 0, isGameOver: true };
          }
          return { ...prev, timeLeft: prev.timeLeft - 1 };
        });
        gameTimeRef.current = now;
      }

      // 2. Player Movement
      const player = playerRef.current;
      const speed = 5;
      if (keysRef.current['ArrowUp'] || keysRef.current['w']) player.y -= speed;
      if (keysRef.current['ArrowDown'] || keysRef.current['s']) player.y += speed;
      if (keysRef.current['ArrowLeft'] || keysRef.current['a']) player.x -= speed;
      if (keysRef.current['ArrowRight'] || keysRef.current['d']) player.x += speed;

      // Boundaries
      player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
      player.y = Math.max(0, Math.min(canvas.height - player.height, player.y));

      // Invulnerability
      if (player.isInvulnerable) {
        player.invulnerabilityTimer--;
        if (player.invulnerabilityTimer <= 0) player.isInvulnerable = false;
      }

      // 3. Shooting
      if (keysRef.current[' '] && now - lastShotTimeRef.current > 200 && gameState.ammo > 0) {
        bulletsRef.current.push({
          x: player.x + player.width,
          y: player.y + player.height / 2 - 2,
          width: 10,
          height: 4,
          speedX: 8,
          speedY: 0,
          color: '#ffff00',
          damage: 1,
        });
        lastShotTimeRef.current = now;
        setGameState(prev => ({ ...prev, ammo: prev.ammo - 1 }));
        sounds.playShoot();
      }

      // 4. Enemy Spawning
      if (Math.random() < config.spawnRate) {
        const typeRoll = Math.random();
        let type: 'basic' | 'fast' | 'tank' = 'basic';
        let health = 1;
        let color = '#ff4444';
        let speedX = -(2 + Math.random() * 2) * config.enemySpeedMult;

        if (typeRoll > 0.8) {
          type = 'tank';
          health = 3;
          color = '#ff00ff';
          speedX = -1 * config.enemySpeedMult;
        } else if (typeRoll > 0.6) {
          type = 'fast';
          health = 1;
          color = '#ffaa00';
          speedX = -(5 + Math.random() * 3) * config.enemySpeedMult;
        }

        enemiesRef.current.push({
          x: canvas.width,
          y: Math.random() * (canvas.height - 40),
          width: type === 'tank' ? 50 : 30,
          height: type === 'tank' ? 50 : 30,
          speedX,
          speedY: 0,
          color,
          type,
          health,
        });
      }

      // 5. PowerUp Spawning
      if (Math.random() < 0.005) {
        const type = Math.random() > 0.7 ? 'life' : 'ammo';
        powerUpsRef.current.push({
          x: canvas.width,
          y: Math.random() * (canvas.height - 30),
          width: 25,
          height: 25,
          speedX: -2,
          speedY: 0,
          color: type === 'life' ? '#00ff00' : '#00ffff',
          type,
        });
      }

      // 6. Collision Detection & Updates
      
      // Bullets
      bulletsRef.current = bulletsRef.current.filter(b => {
        b.x += b.x > 0 ? b.speedX : 0; // Simple move
        return b.x < canvas.width;
      });

      // Enemies
      enemiesRef.current = enemiesRef.current.filter(enemy => {
        enemy.x += enemy.speedX;

        // Check bullet collision
        bulletsRef.current = bulletsRef.current.filter(bullet => {
          const hit = (
            bullet.x < enemy.x + enemy.width &&
            bullet.x + bullet.width > enemy.x &&
            bullet.y < enemy.y + enemy.height &&
            bullet.y + bullet.height > enemy.y
          );
          if (hit) {
            enemy.health -= bullet.damage;
            return false;
          }
          return true;
        });

        if (enemy.health <= 0) {
          setGameState(prev => ({ ...prev, score: prev.score + (enemy.type === 'tank' ? 50 : 10) }));
          sounds.playExplosion();
          return false;
        }

        // Check player collision
        if (!player.isInvulnerable) {
          const hitPlayer = (
            player.x < enemy.x + enemy.width &&
            player.x + player.width > enemy.x &&
            player.y < enemy.y + enemy.height &&
            player.y + player.height > enemy.y
          );
          if (hitPlayer) {
            setGameState(prev => {
              const newLives = prev.lives - 1;
              if (newLives <= 0) return { ...prev, lives: 0, isGameOver: true };
              return { ...prev, lives: newLives };
            });
            player.isInvulnerable = true;
            player.invulnerabilityTimer = 120; // ~2 seconds at 60fps
            sounds.playExplosion();
            return false;
          }
        }

        return enemy.x + enemy.width > 0;
      });

      // PowerUps
      powerUpsRef.current = powerUpsRef.current.filter(p => {
        p.x += p.speedX;
        const hitPlayer = (
          player.x < p.x + p.width &&
          player.x + player.width > p.x &&
          player.y < p.y + p.height &&
          player.y + player.height > p.y
        );
        if (hitPlayer) {
          if (p.type === 'life') {
            setGameState(prev => ({ ...prev, lives: Math.min(prev.lives + 1, 5) }));
          } else {
            setGameState(prev => ({ ...prev, ammo: prev.ammo + 20 }));
          }
          sounds.playPowerUp();
          return false;
        }
        return p.x + p.width > 0;
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const config = DIFFICULTY_CONFIG[gameState.difficulty];

      // Background Grid
      ctx.strokeStyle = config.layoutColor + '22';
      ctx.lineWidth = 1;
      for (let i = 0; i < canvas.width; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i < canvas.height; i += 50) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }

      // Player
      const player = playerRef.current;
      if (!player.isInvulnerable || Math.floor(Date.now() / 100) % 2 === 0) {
        ctx.fillStyle = player.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = player.color;
        // Draw a spaceship shape
        ctx.beginPath();
        ctx.moveTo(player.x, player.y);
        ctx.lineTo(player.x + player.width, player.y + player.height / 2);
        ctx.lineTo(player.x, player.y + player.height);
        ctx.lineTo(player.x + 10, player.y + player.height / 2);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Bullets
      ctx.fillStyle = '#ffff00';
      bulletsRef.current.forEach(b => {
        ctx.fillRect(b.x, b.y, b.width, b.height);
      });

      // Enemies
      enemiesRef.current.forEach(e => {
        ctx.fillStyle = e.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = e.color;
        if (e.type === 'tank') {
          ctx.fillRect(e.x, e.y, e.width, e.height);
          ctx.strokeStyle = '#fff';
          ctx.strokeRect(e.x + 5, e.y + 5, e.width - 10, e.height - 10);
        } else if (e.type === 'fast') {
          ctx.beginPath();
          ctx.moveTo(e.x + e.width, e.y + e.height / 2);
          ctx.lineTo(e.x, e.y);
          ctx.lineTo(e.x, e.y + e.height);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(e.x, e.y, e.width, e.height);
        }
        ctx.shadowBlur = 0;
      });

      // PowerUps
      powerUpsRef.current.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 20;
        ctx.shadowColor = p.color;
        if (p.type === 'life') {
          // Draw heart-ish
          ctx.beginPath();
          ctx.arc(p.x + 7, p.y + 7, 7, 0, Math.PI * 2);
          ctx.arc(p.x + 18, p.y + 7, 7, 0, Math.PI * 2);
          ctx.fillRect(p.x + 2, p.y + 7, 21, 10);
          ctx.fill();
        } else {
          // Draw bolt
          ctx.beginPath();
          ctx.moveTo(p.x + 15, p.y);
          ctx.lineTo(p.x, p.y + 15);
          ctx.lineTo(p.x + 10, p.y + 15);
          ctx.lineTo(p.x + 5, p.y + 25);
          ctx.lineTo(p.x + 25, p.y + 10);
          ctx.lineTo(p.x + 15, p.y + 10);
          ctx.closePath();
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      });
    };

    const loop = () => {
      update();
      draw();
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();

    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState.hasStarted, gameState.isGameOver, gameState.isPaused, gameState.difficulty, gameState.ammo]);

  // Input Handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key] = true;
      if (e.key === 'p' || e.key === 'Escape') {
        setGameState(prev => ({ ...prev, isPaused: !prev.isPaused }));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans overflow-hidden flex flex-col items-center justify-center p-4">
      {/* Header / HUD */}
      <div className="w-full max-w-4xl flex justify-between items-center mb-4 px-4 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 p-4">
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-red-500 fill-red-500" />
            <span className="text-xl font-bold tabular-nums">{gameState.lives}</span>
          </div>
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-yellow-500" />
            <span className="text-xl font-bold tabular-nums">{gameState.ammo}</span>
          </div>
        </div>

        <div className="flex flex-col items-center">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Score</div>
          <div className="text-3xl font-black tracking-tight">{gameState.score.toLocaleString()}</div>
        </div>

        <div className="flex gap-6 items-center">
          <div className="flex items-center gap-2">
            <Timer className="w-5 h-5 text-blue-400" />
            <span className="text-xl font-bold tabular-nums">{gameState.timeLeft}s</span>
          </div>
          <button 
            onClick={toggleMute}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Game Area */}
      <div className="relative w-full max-w-4xl aspect-[16/9] bg-black rounded-3xl overflow-hidden border-2 border-white/5 shadow-2xl shadow-blue-500/10">
        <canvas
          ref={canvasRef}
          width={800}
          height={450}
          className="w-full h-full cursor-crosshair"
        />

        {/* Overlays */}
        <AnimatePresence>
          {!gameState.hasStarted && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center z-50 p-8"
            >
              <motion.h1 
                initial={{ y: -20 }}
                animate={{ y: 0 }}
                className="text-6xl font-black tracking-tighter mb-2 italic text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600"
              >
                NEON DEFENDER
              </motion.h1>
              <p className="text-white/60 mb-12 text-center max-w-md">
                Proteja a galáxia. Use WASD para mover, ESPAÇO para atirar. 
                Gerencie sua munição e tempo.
              </p>

              <div className="grid grid-cols-3 gap-4 w-full max-w-lg">
                {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => startGame(d)}
                    className={`group relative p-6 rounded-2xl border transition-all duration-300 overflow-hidden ${
                      d === 'EASY' ? 'border-emerald-500/30 hover:bg-emerald-500/10' :
                      d === 'MEDIUM' ? 'border-cyan-500/30 hover:bg-cyan-500/10' :
                      'border-rose-500/30 hover:bg-rose-500/10'
                    }`}
                  >
                    <div className={`text-xs font-bold mb-2 ${
                      d === 'EASY' ? 'text-emerald-400' :
                      d === 'MEDIUM' ? 'text-cyan-400' :
                      'text-rose-400'
                    }`}>{d}</div>
                    <div className="text-sm text-white/40 group-hover:text-white/80 transition-colors">
                      {d === 'EASY' ? '120s • 100 Mun' :
                       d === 'MEDIUM' ? '90s • 60 Mun' :
                       '60s • 30 Mun'}
                    </div>
                    <Play className="absolute bottom-4 right-4 w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {gameState.isPaused && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-40"
            >
              <h2 className="text-4xl font-black mb-8">PAUSED</h2>
              <button
                onClick={() => setGameState(prev => ({ ...prev, isPaused: false }))}
                className="px-8 py-3 bg-white text-black font-bold rounded-full hover:scale-105 transition-transform"
              >
                RESUME
              </button>
            </motion.div>
          )}

          {gameState.isGameOver && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center z-50"
            >
              <h2 className="text-7xl font-black text-rose-500 mb-2">GAME OVER</h2>
              <div className="text-2xl mb-12 text-white/60">Final Score: {gameState.score}</div>
              
              <button
                onClick={() => setGameState(prev => ({ ...prev, hasStarted: false, isGameOver: false }))}
                className="px-12 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black rounded-2xl hover:shadow-lg hover:shadow-blue-500/40 transition-all"
              >
                TRY AGAIN
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer / Controls Info */}
      <div className="mt-8 flex gap-8 text-[10px] uppercase tracking-[0.2em] text-white/20">
        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500" /> WASD: Move</div>
        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-cyan-500" /> Space: Shoot</div>
        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-rose-500" /> P: Pause</div>
      </div>
    </div>
  );
}
