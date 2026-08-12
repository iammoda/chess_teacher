// Dependency-free celebration confetti.
//
// burstConfetti() paints a short-lived burst of paper pieces over the page
// using the Web Animations API — no canvas, no timers to leak, no CSS file
// coupling. The overlay is pointer-transparent and removes itself when the
// last piece lands. Honors prefers-reduced-motion by doing nothing.

const INTENSITY_COUNTS = {
  small: 36,
  medium: 70,
  big: 130,
};

const DEFAULT_COLORS = ["#f2c94c", "#2f6fed", "#e8563f", "#2e7d43", "#eda3c9", "#7b5cd6"];

function prefersReducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function burstConfetti({ intensity = "medium", colors = DEFAULT_COLORS } = {}) {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  if (typeof Element === "undefined" || typeof Element.prototype.animate !== "function") return;

  const count = INTENSITY_COUNTS[intensity] || INTENSITY_COUNTS.medium;
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.cssText = "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:9999;";

  const width = window.innerWidth || 1024;
  const height = window.innerHeight || 768;
  let live = 0;

  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    const size = 6 + Math.random() * 7;
    const color = colors[i % colors.length];
    const round = Math.random() < 0.35;
    piece.style.cssText = [
      "position:absolute",
      `width:${size}px`,
      `height:${round ? size : size * 0.45}px`,
      `background:${color}`,
      `border-radius:${round ? "50%" : "2px"}`,
      "top:0",
      "left:0",
      "will-change:transform,opacity",
    ].join(";");
    overlay.appendChild(piece);

    // Launch from the bottom middle half of the screen and fan out.
    const startX = width * (0.25 + Math.random() * 0.5);
    const startY = height + 12;
    const peakX = startX + (Math.random() - 0.5) * width * 0.55;
    const peakY = height * (0.12 + Math.random() * 0.3);
    const endX = peakX + (Math.random() - 0.5) * width * 0.25;
    const endY = height + 24;
    const spin = (Math.random() - 0.5) * 1000;
    const duration = 1500 + Math.random() * 1200;

    live += 1;
    const animation = piece.animate(
      [
        { transform: `translate(${startX}px, ${startY}px) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${peakX}px, ${peakY}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.42 },
        { transform: `translate(${endX}px, ${endY}px) rotate(${spin}deg)`, opacity: 0.75 },
      ],
      {
        duration,
        delay: Math.random() * 220,
        easing: "cubic-bezier(0.16, 0.9, 0.4, 1)",
        fill: "forwards",
      },
    );
    animation.onfinish = () => {
      piece.remove();
      live -= 1;
      if (live <= 0) overlay.remove();
    };
  }

  document.body.appendChild(overlay);
  // Belt and braces: even if onfinish never fires (tab hidden pauses
  // animations in some engines), the overlay must not linger forever.
  setTimeout(() => overlay.remove(), 6000);
}
