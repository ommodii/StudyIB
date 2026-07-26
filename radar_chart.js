/**
 * RadarChart — Lightweight Canvas-based radar/spider chart
 * Renders a performance overview showing completion % per topic.
 * Uses CSS custom properties for theming.
 */
window.RadarChart = (() => {
    function render(canvasId, data, options = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || !data || data.length < 3) return;

        const container = canvas.parentElement;
        if (!container) return;

        // Use ResizeObserver to defer rendering until the canvas wrapper has a non-zero layout size.
        // This solves empty chart bugs caused by asynchronous overlay display animations.
        const observer = new ResizeObserver(() => {
            const width = container.offsetWidth;
            if (width > 0) {
                observer.disconnect();
                drawChart(canvas, data, width, options);
            }
        });
        observer.observe(container);
    }

    function drawChart(canvas, data, containerWidth, options = {}) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const size = Math.min(containerWidth, 420);

        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        ctx.scale(dpr, dpr);

        const cx = size / 2;
        const cy = size / 2;
        const radius = size * 0.36;
        const levels = 5;
        const n = data.length;
        const angleStep = (Math.PI * 2) / n;
        const startAngle = -Math.PI / 2; // Start from top

        // Read theme colors from CSS
        const styles = getComputedStyle(document.documentElement);
        const accent = styles.getPropertyValue('--accent').trim() || '#6366f1';
        const textColor = styles.getPropertyValue('--text-primary').trim() || '#e2e8f0';
        const mutedColor = styles.getPropertyValue('--text-muted').trim() || '#64748b';
        const gridColor = styles.getPropertyValue('--border').trim() || 'rgba(148,163,184,0.15)';

        // Animation state
        let progress = 0;
        const duration = 800; // ms
        const startTime = performance.now();

        function animate(now) {
            progress = Math.min(1, (now - startTime) / duration);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic

            ctx.clearRect(0, 0, size, size);

            // --- Draw grid rings ---
            for (let i = 1; i <= levels; i++) {
                const r = (radius / levels) * i;
                ctx.beginPath();
                for (let j = 0; j <= n; j++) {
                    const angle = startAngle + angleStep * j;
                    const x = cx + r * Math.cos(angle);
                    const y = cy + r * Math.sin(angle);
                    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.strokeStyle = gridColor;
                ctx.lineWidth = 1;
                ctx.stroke();

                // Percentage labels on the right axis
                if (i % 2 !== 0 || i === levels) {
                    const pct = Math.round((i / levels) * 100);
                    ctx.fillStyle = mutedColor;
                    ctx.font = `${size * 0.025}px -apple-system, BlinkMacSystemFont, sans-serif`;
                    ctx.textAlign = 'left';
                    ctx.fillText(`${pct}%`, cx + r + 4, cy - 2);
                }
            }

            // --- Draw axis lines ---
            for (let i = 0; i < n; i++) {
                const angle = startAngle + angleStep * i;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
                ctx.strokeStyle = gridColor;
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // --- Draw data polygon ---
            ctx.beginPath();
            for (let i = 0; i <= n; i++) {
                const idx = i % n;
                const val = data[idx].maxValue > 0 ? data[idx].value / data[idx].maxValue : 0;
                const r = radius * val * eased;
                const angle = startAngle + angleStep * idx;
                const x = cx + r * Math.cos(angle);
                const y = cy + r * Math.sin(angle);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath();

            // Gradient fill
            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            gradient.addColorStop(0, hexToRgba(accent, 0.35));
            gradient.addColorStop(1, hexToRgba(accent, 0.08));
            ctx.fillStyle = gradient;
            ctx.fill();

            // Stroke
            ctx.strokeStyle = accent;
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // --- Draw data points ---
            for (let i = 0; i < n; i++) {
                const val = data[i].maxValue > 0 ? data[i].value / data[i].maxValue : 0;
                const r = radius * val * eased;
                const angle = startAngle + angleStep * i;
                const x = cx + r * Math.cos(angle);
                const y = cy + r * Math.sin(angle);

                // Outer glow
                ctx.beginPath();
                ctx.arc(x, y, 5, 0, Math.PI * 2);
                ctx.fillStyle = hexToRgba(accent, 0.3);
                ctx.fill();

                // Inner dot
                ctx.beginPath();
                ctx.arc(x, y, 3, 0, Math.PI * 2);
                ctx.fillStyle = accent;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // --- Draw labels ---
            ctx.font = `600 ${size * 0.028}px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif`;
            ctx.textBaseline = 'middle';

            for (let i = 0; i < n; i++) {
                const angle = startAngle + angleStep * i;
                const labelRadius = radius + size * 0.07;
                const lx = cx + labelRadius * Math.cos(angle);
                const ly = cy + labelRadius * Math.sin(angle);

                // Truncate long labels
                let label = data[i].label;
                if (label.length > 18) label = label.substring(0, 16) + '…';

                // Determine alignment based on position
                if (Math.abs(Math.cos(angle)) < 0.15) {
                    ctx.textAlign = 'center';
                } else if (Math.cos(angle) > 0) {
                    ctx.textAlign = 'left';
                } else {
                    ctx.textAlign = 'right';
                }

                // Completion percentage coloring
                const pct = data[i].maxValue > 0 ? data[i].value / data[i].maxValue : 0;
                if (pct >= 0.7) {
                    ctx.fillStyle = '#22c55e'; // green
                } else if (pct >= 0.4) {
                    ctx.fillStyle = '#f59e0b'; // amber
                } else {
                    ctx.fillStyle = textColor;
                }

                ctx.fillText(label, lx, ly);

                // Small percentage below label
                const pctText = `${Math.round(pct * 100)}%`;
                ctx.font = `500 ${size * 0.022}px -apple-system, BlinkMacSystemFont, sans-serif`;
                ctx.fillStyle = mutedColor;
                ctx.fillText(pctText, lx, ly + size * 0.035);
                ctx.font = `600 ${size * 0.028}px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif`;
            }

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        }

        requestAnimationFrame(animate);

        // --- Hover tooltip ---
        let tooltip = document.getElementById('radarTooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'radarTooltip';
            tooltip.className = 'radar-tooltip';
            document.body.appendChild(tooltip);
        }

        canvas.onmousemove = (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            let found = false;
            for (let i = 0; i < n; i++) {
                const val = data[i].maxValue > 0 ? data[i].value / data[i].maxValue : 0;
                const r = radius * val;
                const angle = startAngle + angleStep * i;
                const px = cx + r * Math.cos(angle);
                const py = cy + r * Math.sin(angle);
                const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);

                if (dist < 12) {
                    tooltip.innerHTML = `<strong>${data[i].label}</strong><br>${data[i].value} / ${data[i].maxValue} completed (${Math.round(val * 100)}%)`;
                    tooltip.style.left = `${e.clientX + 12}px`;
                    tooltip.style.top = `${e.clientY - 30}px`;
                    tooltip.style.opacity = '1';
                    found = true;
                    break;
                }
            }

            if (!found) {
                tooltip.style.opacity = '0';
            }
        };

        canvas.onmouseleave = () => {
            if (tooltip) tooltip.style.opacity = '0';
        };
    }

    function hexToRgba(hex, alpha) {
        if (hex.startsWith('rgb')) {
            return hex.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
        }
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    return { render };
})();
