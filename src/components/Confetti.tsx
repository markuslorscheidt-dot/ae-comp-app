'use client';

import { useEffect, useState } from 'react';

interface ConfettiProps {
  active: boolean;
  onComplete?: () => void;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  rotation: number;
  scale: number;
  velocityX: number;
  velocityY: number;
}

const COLORS = [
  '#FFD700', // Gold
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#98D8C8', // Mint
];

export default function Confetti({ active, onComplete }: ConfettiProps) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!active) {
      setParticles([]);
      return;
    }

    // Erstelle Partikel
    const newParticles: Particle[] = [];
    for (let i = 0; i < 100; i++) {
      newParticles.push({
        id: i,
        x: Math.random() * 100,
        y: -10 - Math.random() * 20,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        scale: 0.5 + Math.random() * 0.5,
        velocityX: (Math.random() - 0.5) * 4,
        velocityY: 2 + Math.random() * 3,
      });
    }
    setParticles(newParticles);

    // Animation Loop
    let frame = 0;
    const maxFrames = 150;
    
    const animate = () => {
      frame++;
      if (frame >= maxFrames) {
        setParticles([]);
        onComplete?.();
        return;
      }

      setParticles(prev => prev.map(p => ({
        ...p,
        y: p.y + p.velocityY,
        x: p.x + p.velocityX,
        rotation: p.rotation + 5,
        velocityY: p.velocityY + 0.1, // Gravity
      })));

      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, [active, onComplete]);

  if (!active && particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map(particle => (
        <div
          key={particle.id}
          className="absolute w-3 h-3"
          style={{
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            backgroundColor: particle.color,
            transform: `rotate(${particle.rotation}deg) scale(${particle.scale})`,
            borderRadius: Math.random() > 0.5 ? '50%' : '0%',
          }}
        />
      ))}
    </div>
  );
}

// Badge Unlock Animation
interface BadgeUnlockProps {
  badge: {
    icon: string;
    nameKey: string;
  };
  onClose: () => void;
  t: (key: string) => string;
}

export function BadgeUnlockAnimation({ badge, onClose, t }: BadgeUnlockProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, 3000);

    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <>
      <Confetti active={true} />
      <div 
        className={`fixed inset-0 flex items-center justify-center z-50 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      >
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center transform animate-bounce-in">
          <div className="text-6xl mb-4 animate-pulse">{badge.icon}</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            🎉 {t('badges.newBadge')}
          </h2>
          <p className="text-xl text-purple-600 font-medium">
            {t(badge.nameKey)}
          </p>
        </div>
      </div>
    </>
  );
}
