const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

const anchor = 'function exportCandidatesExcel() {';
const index = content.indexOf(anchor);

if (index === -1) {
  console.log("Anchor not found");
  process.exit(1);
}

const cleanContent = content.substring(0, index);

const tail = `function exportCandidatesExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('error', 'Library Missing', 'Excel export library not loaded. Please use CSV.');
    return;
  }
  window.MemoryEngine.getAllCandidates().then(candidates => {
    if (candidates.length === 0) {
      showToast('warning', 'No Candidates', 'No candidate data to export.');
      return;
    }
    
    const rows = candidates.map(c => ({
      'Candidate Name': c.name,
      'Job Role': c.role,
      'City': c.city,
      'Phone': c.phone,
      'Email': c.email || '',
      'Source Link': c.url,
      'Description / Snippet': c.description || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Candidates");

    // Auto-fit Columns width calculation
    const maxProps = [];
    rows.forEach(row => {
      Object.keys(row).forEach((key, colIndex) => {
        const val = row[key] ? String(row[key]) : '';
        maxProps[colIndex] = Math.max(maxProps[colIndex] || 15, val.length + 2, key.length + 2);
      });
    });
    
    // Cap max width at 60 characters to prevent overly wide columns
    worksheet['!cols'] = maxProps.map(w => ({ wch: Math.min(w, 60) }));

    const dateStr = new Date().toISOString().slice(0,10);
    XLSX.writeFile(workbook, \`Skylark_Candidates_\${dateStr}.xlsx\`);
    showToast('success', 'Excel Downloaded', 'Candidate data successfully exported as Excel.');
  });
}

// ============================================================
//  REAL-TIME TOKEN COUNTERS UPDATE
// ============================================================
window.updateRealtimeTokenCounters = function() {
  if (!window.MemoryEngine) return;
  const cfg = window.SKYLARK_CONFIG || {};
  const apifyLimit = cfg.APIFY_KEY_LIMIT || 500;
  const activeApifyIdx = window.MemoryEngine.getActiveApifyIdx();
  const totalApifyUsed = window.MemoryEngine.getKeyUsage('apify', activeApifyIdx);
  
  const homeBadge = document.getElementById('home-token-counter');
  const candidateBadge = document.getElementById('candidate-token-counter');
  
  if (homeBadge) homeBadge.textContent = \`\${totalApifyUsed} / \${apifyLimit}\`;
  if (candidateBadge) candidateBadge.textContent = \`Apify Key #\${activeApifyIdx + 1} | \${totalApifyUsed} / \${apifyLimit}\`;
  
  if (typeof restoreTokenCounter === 'function') {
    restoreTokenCounter();
  }
}

// Initial call
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.updateRealtimeTokenCounters === 'function') {
    setTimeout(() => window.updateRealtimeTokenCounters(), 1000);
  }
});

// ============================================================
//  CANDIDATE DB OPERATIONS
// ============================================================
window.deleteCandidateRow = async function(id) {
  if (confirm('Are you sure you want to delete this candidate?')) {
    if (window.MemoryEngine && window.MemoryEngine.deleteCandidate) {
      await window.MemoryEngine.deleteCandidate(id);
      showToast('success', 'Deleted', 'Candidate removed from database.');
      await initCandidatesView();
    }
  }
};

window.clearAllCandidates = async function() {
  if (confirm('Are you sure you want to delete ALL candidates? This cannot be undone.')) {
    if (window.MemoryEngine && window.MemoryEngine.getAllCandidates) {
      const candidates = await window.MemoryEngine.getAllCandidates();
      for (const c of candidates) {
        await window.MemoryEngine.deleteCandidate(c.id);
      }
      showToast('success', 'Cleared', 'All candidates removed from database.');
      await initCandidatesView();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => initCandidatesView(), 500);
  if (typeof restoreTokenCounter === 'function') {
    restoreTokenCounter();
  }
});

// Settings Accordion Logic
window.toggleAccordion = function(headerElement) {
  const accordion = headerElement.closest('.settings-accordion');
  accordion.classList.toggle('open');
};

// =========================================================
// 3D PARTICLE DOT-MATRIX ORB (ADVANCED VOICE UI)
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('jarvisOrbCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let width = canvas.width;
  let height = canvas.height;
  
  // 3D Sphere settings
  const particles = [];
  const particleCount = 1500; // High density for the dot-matrix look
  const baseRadius = 60; // Coin size
  
  // Orb State Management
  window.jarvisOrbState = 'idle'; // idle, listening, processing, speaking
  window.setJarvisOrbState = (state) => {
    window.jarvisOrbState = state;
  };
  
  // Golden ratio to evenly distribute points on a sphere
  const phi = Math.PI * (3 - Math.sqrt(5));
  
  for (let i = 0; i < particleCount; i++) {
    const y = 1 - (i / (particleCount - 1)) * 2; // y goes from 1 to -1
    const r = Math.sqrt(1 - y * y); // radius at y
    const theta = phi * i; // golden angle increment
    
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    
    particles.push({
      originalX: x,
      originalY: y,
      originalZ: z,
      randPhase: Math.random() * Math.PI * 2 // for random pitch simulation
    });
  }
  
  let time = 0;
  
  function draw() {
    ctx.clearRect(0, 0, width, height);
    
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isDark = theme === 'dark';
    
    const cx = width / 2;
    const cy = height / 2;
    
    // State dependent variables
    let rotSpeed = 0.002;
    let waveIntensity = 0;
    let voicePitch = 0;
    // Default Idle colors
    let colorBase = isDark ? [255, 255, 255] : [15, 23, 42]; 
    let particleSizeMultiplier = 1;
    
    if (window.jarvisOrbState === 'listening') {
      rotSpeed = 0.004;
      // Fast, sharp sine waves simulating mic input
      voicePitch = Math.sin(time * 18) * 0.4 + Math.sin(time * 8 + 2) * 0.2; 
      waveIntensity = 0.3 + voicePitch;
      colorBase = isDark ? [56, 189, 248] : [2, 132, 199]; // Sky Blue
      particleSizeMultiplier = 1.1;
    } else if (window.jarvisOrbState === 'processing') {
      rotSpeed = 0.015; // Fast spin
      // Smooth traveling ripples
      waveIntensity = 0.5;
      voicePitch = 0;
      colorBase = isDark ? [168, 85, 247] : [126, 34, 206]; // Purple
    } else if (window.jarvisOrbState === 'speaking') {
      rotSpeed = 0.003;
      // Bouncy, rhythmic waves simulating speaking
      voicePitch = Math.sin(time * 12) * 0.5 + Math.sin(time * 4 + 1) * 0.3; 
      waveIntensity = 0.5 + Math.abs(voicePitch);
      colorBase = isDark ? [74, 222, 128] : [22, 163, 74]; // Green
      particleSizeMultiplier = 1.25;
    }
    
    time += rotSpeed;
    
    // Rotation matrices
    const cosY = Math.cos(time);
    const sinY = Math.sin(time);
    const cosX = Math.cos(time * 0.4);
    const sinX = Math.sin(time * 0.4);
    
    particles.forEach((p) => {
      // Apply voice/wave distortion to radius
      let currentRadius = baseRadius;
      
      if (waveIntensity > 0) {
        // Create ripples across the sphere based on Y and X position
        const ripple = Math.sin(p.originalY * 8 + time * 10) * Math.cos(p.originalX * 8 - time * 10);
        // Add rapid pitch noise during listening/speaking
        const pitchNoise = Math.sin(time * 25 + p.randPhase) * voicePitch * 12;
        
        currentRadius += (ripple * waveIntensity * 6) + pitchNoise;
      }
      
      const px_3d = p.originalX * currentRadius;
      const py_3d = p.originalY * currentRadius;
      const pz_3d = p.originalZ * currentRadius;
      
      // Rotate around Y
      let x1 = px_3d * cosY - pz_3d * sinY;
      let z1 = pz_3d * cosY + px_3d * sinY;
      
      // Rotate around X
      let y1 = py_3d * cosX - z1 * sinX;
      let z2 = z1 * cosX + py_3d * sinX;
      
      // Perspective projection
      const perspective = 250 / (250 + z2);
      const px = cx + x1 * perspective;
      const py = cy + y1 * perspective;
      
      // Size fades based on depth (z2)
      // If z2 is positive, it's closer to camera, if negative, it's further
      const depthFactor = (z2 + baseRadius) / (baseRadius * 2); // 0 (back) to 1 (front)
      
      // Make particles in the back smaller, in front slightly bigger
      let size = (0.4 + depthFactor * 1.2) * perspective * particleSizeMultiplier;
      
      // Opacity fades in the back to give 3D spherical depth illusion
      let opacity = 0.15 + (depthFactor * 0.85);
      
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.1, size), 0, Math.PI * 2);
      ctx.fillStyle = \`rgba(\${colorBase[0]}, \${colorBase[1]}, \${colorBase[2]}, \${opacity})\`;
      ctx.fill();
    });
    
    requestAnimationFrame(draw);
  }
  
  draw();
  
  // Interactive Demo: Click the orb to cycle through states!
  canvas.addEventListener('click', () => {
    const states = ['idle', 'listening', 'processing', 'speaking'];
    let currentIndex = states.indexOf(window.jarvisOrbState);
    let nextIndex = (currentIndex + 1) % states.length;
    window.setJarvisOrbState(states[nextIndex]);
    
    if (typeof showToast === 'function') {
      showToast('info', 'Orb State Changed', \`Switched to: \${states[nextIndex].toUpperCase()}\`);
    }
  });
  
  canvas.style.cursor = 'pointer';
  canvas.title = "Click me to test voice animations!";
});
`;

fs.writeFileSync('app.js', cleanContent + tail);
console.log("Successfully fixed app.js");
