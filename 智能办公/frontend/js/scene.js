(() => {
  if (document.querySelector(".ambient-scene")) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas");
  canvas.className = "ambient-scene";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let animationFrame = 0;
  let points = [];
  let links = [];

  function buildSphere() {
    const count = width < 700 ? 48 : 82;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    points = Array.from({ length: count }, (_, index) => {
      const y = 1 - (index / Math.max(count - 1, 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = goldenAngle * index;
      return {
        x: Math.cos(angle) * radius,
        y,
        z: Math.sin(angle) * radius,
        phase: (index * 0.71) % (Math.PI * 2),
      };
    });

    links = [];
    const threshold = width < 700 ? 0.62 : 0.48;
    for (let first = 0; first < points.length; first += 1) {
      for (let second = first + 1; second < points.length; second += 1) {
        const a = points[first];
        const b = points[second];
        const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        if (distance < threshold) links.push([first, second, 1 - distance / threshold]);
      }
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    buildSphere();
  }

  function rotate(point, angleY, angleX) {
    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const x = point.x * cosY - point.z * sinY;
    const zY = point.x * sinY + point.z * cosY;
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);
    return {
      x,
      y: point.y * cosX - zY * sinX,
      z: point.y * sinX + zY * cosX,
      phase: point.phase,
    };
  }

  function draw(timestamp = 0) {
    context.clearRect(0, 0, width, height);
    pointer.x += (pointer.targetX - pointer.x) * 0.035;
    pointer.y += (pointer.targetY - pointer.y) * 0.035;

    const isLogin = document.body.classList.contains("login-page");
    const centerX = width < 700 ? width * 0.5 : width * (isLogin ? 0.27 : 0.7);
    const centerY = height * (isLogin ? 0.47 : 0.4);
    const radius = Math.min(width < 700 ? width * 0.48 : width * (isLogin ? 0.2 : 0.24), height * 0.39, 310);
    const time = reduceMotion.matches ? 0.9 : timestamp * 0.00008;
    const angleY = time + pointer.x * 0.22;
    const angleX = -0.18 + Math.sin(time * 0.65) * 0.08 + pointer.y * 0.14;
    const focalLength = 3.4;

    const glow = context.createRadialGradient(centerX, centerY, 10, centerX, centerY, radius * 1.45);
    glow.addColorStop(0, "rgba(79, 70, 229, 0.11)");
    glow.addColorStop(0.42, "rgba(14, 165, 233, 0.055)");
    glow.addColorStop(1, "rgba(37, 99, 235, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(centerX, centerY, radius * 1.45, 0, Math.PI * 2);
    context.fill();

    const projected = points.map((point) => {
      const rotated = rotate(point, angleY, angleX);
      const depth = focalLength + rotated.z;
      const scale = focalLength / depth;
      return {
        x: centerX + rotated.x * radius * scale + pointer.x * 18,
        y: centerY + rotated.y * radius * scale + pointer.y * 14,
        z: rotated.z,
        scale,
        phase: rotated.phase,
      };
    });

    context.lineWidth = 0.8;
    for (const [first, second, strength] of links) {
      const a = projected[first];
      const b = projected[second];
      const visibility = Math.max(0.07, (a.z + b.z + 2) / 4);
      context.strokeStyle = `rgba(79, 118, 238, ${0.05 + strength * visibility * 0.2})`;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }

    projected
      .sort((a, b) => a.z - b.z)
      .forEach((point) => {
        const pulse = reduceMotion.matches ? 1 : 0.82 + Math.sin(timestamp * 0.0012 + point.phase) * 0.18;
        const size = Math.max(1.2, (1.55 + (point.z + 1) * 1.25) * point.scale * pulse);
        context.fillStyle = point.z > 0.15 ? "rgba(79, 70, 229, 0.72)" : "rgba(14, 165, 233, 0.38)";
        context.beginPath();
        context.arc(point.x, point.y, size, 0, Math.PI * 2);
        context.fill();
      });

    if (!reduceMotion.matches && !document.hidden) animationFrame = requestAnimationFrame(draw);
  }

  function restart() {
    cancelAnimationFrame(animationFrame);
    draw(performance.now());
  }

  window.addEventListener("pointermove", (event) => {
    pointer.targetX = event.clientX / Math.max(width, 1) - 0.5;
    pointer.targetY = event.clientY / Math.max(height, 1) - 0.5;
  }, { passive: true });
  window.addEventListener("pointerleave", () => {
    pointer.targetX = 0;
    pointer.targetY = 0;
  });
  window.addEventListener("resize", () => {
    resize();
    restart();
  }, { passive: true });
  document.addEventListener("visibilitychange", restart);
  reduceMotion.addEventListener?.("change", restart);

  resize();
  restart();
})();
