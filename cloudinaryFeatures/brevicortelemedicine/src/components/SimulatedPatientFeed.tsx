import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

export interface SimulatedFeedHandle {
  getMediaElement: () => HTMLCanvasElement | null;
}

export const SimulatedPatientFeed = forwardRef<SimulatedFeedHandle>((_props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useImperativeHandle(ref, () => ({
    getMediaElement: () => canvasRef.current,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    const render = () => {
      time += 0.03;
      const w = canvas.width;
      const h = canvas.height;

      // 1. Soft Clinical Ambient Background (Patient's Room / Clinic)
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // 2. Simulated Patient Head / Shoulders Outline (Simulated Consultation)
      ctx.save();
      const breathOffset = Math.sin(time * 1.5) * 4;
      
      // Shoulders
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.ellipse(w / 2, h + 80 + breathOffset, 240, 160, 0, Math.PI, 0);
      ctx.fill();

      // Head
      ctx.fillStyle = '#f8d5c2'; // Skin base
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2 - 20 + breathOffset, 110, 140, 0, 0, Math.PI * 2);
      ctx.fill();

      // Hair
      ctx.fillStyle = '#291811';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 - 90 + breathOffset, 120, Math.PI * 0.9, Math.PI * 2.1);
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#1e293b';
      const eyeBlink = Math.sin(time * 0.4) > 0.98 ? 1 : 8;
      ctx.beginPath();
      ctx.ellipse(w / 2 - 42, h / 2 - 40 + breathOffset, 12, eyeBlink, 0, 0, Math.PI * 2);
      ctx.ellipse(w / 2 + 42, h / 2 - 40 + breathOffset, 12, eyeBlink, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nose
      ctx.strokeStyle = '#d79c80';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2 - 30 + breathOffset);
      ctx.lineTo(w / 2 - 6, h / 2 - 5 + breathOffset);
      ctx.lineTo(w / 2 + 6, h / 2 - 5 + breathOffset);
      ctx.stroke();

      // Mouth
      ctx.strokeStyle = '#c56868';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 + 30 + breathOffset, 25, 0.2, Math.PI - 0.2);
      ctx.stroke();

      // 3. Clinical Pathology Subject: Skin Erythema / Lesion on Left Cheek for Dermatology Demo
      const lesionX = w / 2 - 65;
      const lesionY = h / 2 + breathOffset;
      
      // Erythema flare
      const lesionGrad = ctx.createRadialGradient(lesionX, lesionY, 2, lesionX, lesionY, 28);
      lesionGrad.addColorStop(0, 'rgba(225, 29, 72, 0.9)'); // Bright erythema core
      lesionGrad.addColorStop(0.5, 'rgba(239, 68, 68, 0.6)');
      lesionGrad.addColorStop(1, 'rgba(254, 202, 202, 0)');
      ctx.fillStyle = lesionGrad;
      ctx.beginPath();
      ctx.arc(lesionX, lesionY, 32, 0, Math.PI * 2);
      ctx.fill();

      // Micro-texture / irregular wound border (dermatology test target)
      ctx.strokeStyle = 'rgba(185, 28, 28, 0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.4) {
        const r = 16 + Math.sin(a * 4 + time) * 3;
        const px = lesionX + Math.cos(a) * r;
        const py = lesionY + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();

      ctx.restore();

      // 4. Clinical Telemedicine Overlay (Subtle reticle & stream metadata)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '12px monospace';
      ctx.fillText(`PATIENT FEED • 720p 30FPS • BITRATE: 2.4 Mbps`, 16, 28);
      ctx.fillText(`OHIP: 4829-192-384 • UTC ${new Date().toISOString().substring(11, 19)}`, 16, 46);

      // Subtle simulated medical tracking reticle around the lesion
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(lesionX - 42, lesionY - 42, 84, 84);
      ctx.setLineDash([]);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px monospace';
      ctx.fillText('ROI: LESION', lesionX - 42, lesionY - 48);

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={1280}
      height={720}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'block',
        borderRadius: '8px',
      }}
    />
  );
});

