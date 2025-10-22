
// app.js — Arena 3D full game demo (Three.js)
// No build tooling required. Drop index.html + style.css + this file into a repo and open.

(() => {
  // Basic scene setup
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x051018);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 8, 14);

  // Lights
  const hemi = new THREE.HemisphereLight(0x9999ff, 0x101020, 0.6);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(10, 20, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  scene.add(dir);

  // Arena floor: low-poly grid + walls
  const arenaSize = 60;
  const floorGeo = new THREE.PlaneGeometry(arenaSize, arenaSize, arenaSize / 2, arenaSize / 2);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0d2430, roughness: 0.9, metalness: 0.02 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Boundary walls
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x08202a, roughness: 0.9 });
  const wallThickness = 1;
  const wallHeight = 8;
  function makeWall(w, h, d, x, y, z, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, wallMaterial);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
    colliders.push({ mesh: m, box: new THREE.Box3().setFromObject(m) });
  }
  const colliders = [];
  // Four walls
  makeWall(arenaSize, wallHeight, wallThickness, 0, wallHeight / 2 - 1, -arenaSize / 2 + wallThickness / 2); // back
  makeWall(arenaSize, wallHeight, wallThickness, 0, wallHeight / 2 - 1, arenaSize / 2 - wallThickness / 2); // front
  makeWall(wallThickness, wallHeight, arenaSize, -arenaSize / 2 + wallThickness / 2, wallHeight / 2 - 1, 0); // left
  makeWall(wallThickness, wallHeight, arenaSize, arenaSize / 2 - wallThickness / 2, wallHeight / 2 - 1, 0); // right

  // Player (low poly box-person)
  const player = {
    mesh: null,
    velocity: new THREE.Vector3(),
    speed: 12,
    health: 100,
    ammo: 30,
    maxAmmo: 30,
    canShoot: true,
    shootCooldown: 160, // ms
    lastShot: 0,
    radius: 0.9,
    alive: true,
    score: 0,
    kills: 0
  };

  function createPlayer() {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xffb86b }));
    body.position.set(0, 1.2, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);
    player.mesh = body;
  }
  createPlayer();

  // Camera follow helper: third-person offset
  const camOffset = new THREE.Vector3(0, 6, 12);

  // Basic bots container
  const bots = [];
  function spawnBot(x = (Math.random() - 0.5) * 30, z = (Math.random() - 0.5) * 30) {
    const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.5);
    const geo = new THREE.BoxGeometry(1.6, 1.8, 1.6);
    const mat = new THREE.MeshStandardMaterial({ color: color.getHex() });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.9, z);
    mesh.castShadow = true;
    scene.add(mesh);

    const bot = {
      mesh,
      health: 40 + Math.floor(Math.random() * 30),
      speed: 6 + Math.random() * 4,
      state: 'wander',
      target: new THREE.Vector3(),
      lastShot: 0,
      shootCooldown: 700 + Math.random() * 600,
      radius: 0.9,
      alive: true
    };
    bots.push(bot);
  }

  // Bullets (simple spheres)
  const bullets = [];
  function shootBullet(origin, dir, owner) {
    const geo = new THREE.SphereGeometry(0.16, 6, 6);
    const mat = new THREE.MeshStandardMaterial({ color: owner === 'player' ? 0xffe08a : 0xff6b6b, emissive: 0x222222 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    bullets.push({
      mesh,
      dir: dir.clone().normalize(),
      speed: 58,
      life: 2500,
      owner
    });
    // small recoil/push
    if(owner === 'player') player.velocity.addScaledVector(dir.clone().negate(), 0.4);
    // sound
    playShot();
  }

  // Simple powerups
  const powerups = [];
  function spawnPowerup(type, pos) {
    const colors = { ammo: 0x6bd0ff, health: 0x6bffb8, boost: 0xffb86b };
    const mat = new THREE.MeshStandardMaterial({ color: colors[type] || 0xffff88, emissive: 0x111111 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    powerups.push({ mesh, type, life: 18000 });
  }

  // Basic world colliders update helper
  function updateColliders() {
    colliders.forEach(c => c.box.setFromObject(c.mesh));
  }

  // HUD hooks
  const scoreEl = document.getElementById('score');
  const killsEl = document.getElementById('kills');
  const healthEl = document.getElementById('health');
  const ammoEl = document.getElementById('ammo-count');
  const startBtn = document.getElementById('startBtn');
  const spawnBotBtn = document.getElementById('spawnBotBtn');
  const resetBtn = document.getElementById('resetBtn');
  const menu = document.getElementById('menu');

  startBtn.onclick = startGame;
  spawnBotBtn.onclick = () => spawnBot();
  resetBtn.onclick = resetGame;

  // Input
  const keys = {};
  window.addEventListener('keydown', e => keys[e.code] = true);
  window.addEventListener('keyup', e => keys[e.code] = false);

  // Pointer lock for better mouse control
  let pointerLocked = false;
  canvas.addEventListener('click', () => {
    if (!pointerLocked) {
      canvas.requestPointerLock?.();
    }
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
  });

  // Mouse aim — camera rel
  let mouseDX = 0, mouseDY = 0;
  document.addEventListener('mousemove', (e) => {
    if (!pointerLocked) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  });

  // Shooting on mouse click
  window.addEventListener('mousedown', e => {
    if (!gameRunning) return;
    if (e.button === 0) playerShoot();
  });

  // Touch controls (basic)
  let touchStart = null;
  window.addEventListener('touchstart', (e) => {
    touchStart = e.touches[0];
    // quick tap = shoot
    if (gameRunning) playerShoot();
  }, {passive:true});
  window.addEventListener('touchmove', (e) => {
    e.preventDefault();
  }, {passive:false});

  // Basic audio (WebAudio)
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) { audioCtx = null; }
  }
  function playShot() {
    ensureAudio();
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = 800;
    g.gain.value = 0.03;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.08);
  }
  function playHitSound() {
    ensureAudio();
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = 1200;
    const g = audioCtx.createGain(); g.gain.value = 0.05;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.06);
  }
  function playPickup() {
    ensureAudio();
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    o.type = 'sine'; o.frequency.value = 880;
    const g = audioCtx.createGain(); g.gain.value = 0.04;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.12);
  }

  // Game logic
  let lastTime = performance.now();
  let gameRunning = false;
  let accumulatedSpawn = 0;
  let botCount = 4;

  function startGame() {
    menu.style.display = 'none';
    // reset
    player.health = 100;
    player.ammo = player.maxAmmo;
    player.score = 0; player.kills = 0;
    player.mesh.position.set(0, 1.2, 0);
    bullets.forEach(b => scene.remove(b.mesh));
    bullets.length = 0;
    bots.forEach(b => scene.remove(b.mesh));
    bots.length = 0;
    powerups.forEach(p => scene.remove(p.mesh));
    powerups.length = 0;
    for (let i = 0; i < botCount; i++) spawnBot();
    updateUI();
    gameRunning = true;
    lastTime = performance.now();
    loop();
  }

  function resetGame() {
    menu.style.display = 'block';
    gameRunning = false;
    // tidy up
  }

  function updateUI() {
    scoreEl.textContent = Math.floor(player.score);
    killsEl.textContent = player.kills;
    healthEl.textContent = '❤ ' + Math.max(0, Math.floor(player.health));
    ammoEl.textContent = player.ammo;
  }

  function playerShoot() {
    if (!player.alive) return;
    const now = performance.now();
    if (now - player.lastShot < player.shootCooldown) return;
    if (player.ammo <= 0) return;
    player.lastShot = now;
    player.ammo--;
    // compute direction from camera to center / forward vector of player
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.mesh.quaternion);
    const origin = player.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0)).add(forward.clone().multiplyScalar(1.6));
    shootBullet(origin, forward, 'player');
    updateUI();
  }

  // simple player movement & orientation
  const tempVec = new THREE.Vector3();
  function updatePlayer(dt) {
    // rotate player by mouseDX (yaw)
    const yaw = -mouseDX * 0.002; // sensitivity
    player.mesh.rotation.y += yaw;
    mouseDX = 0;

    // jump (simple)
    if (keys['Space']) {
      // small jump impulse
      player.velocity.y = Math.max(player.velocity.y, 8);
    }
    // movement local forward/back/left/right based on player's rotation
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.mesh.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(player.mesh.quaternion);
    tempVec.set(0, 0, 0);
    if (keys['KeyW']) tempVec.add(forward);
    if (keys['KeyS']) tempVec.add(forward.clone().negate());
    if (keys['KeyA']) tempVec.add(right.clone().negate());
    if (keys['KeyD']) tempVec.add(right);
    if (tempVec.lengthSq() > 0) {
      tempVec.normalize().multiplyScalar(player.speed * dt / 1000);
      player.mesh.position.add(tempVec);
    }

    // simple gravity & ground clamp
    player.velocity.y = (player.velocity.y || 0) - 30 * dt / 1000;
    player.mesh.position.y += player.velocity.y * dt / 1000;
    if (player.mesh.position.y < 1.2) {
      player.mesh.position.y = 1.2;
      player.velocity.y = 0;
    }

    // collision with walls (box-check and push back)
    const pBox = new THREE.Box3().setFromCenterAndSize(player.mesh.position.clone().add(new THREE.Vector3(0,1.1,0)), new THREE.Vector3(1.6, 2.2, 1.6));
    for (const c of colliders) {
      if (pBox.intersectsBox(c.box)) {
        // naive push out: move player opposite to directional vector from collider center
        const center = c.box.getCenter(new THREE.Vector3());
        const push = player.mesh.position.clone().sub(center).setY(0).normalize().multiplyScalar(0.6);
        player.mesh.position.add(push);
      }
    }
  }

  // Bot AI (wander, chase player when close, shoot)
  function updateBots(dt) {
    bots.forEach((b) => {
      if (!b.alive) return;
      // distance to player
      const d = b.mesh.position.distanceTo(player.mesh.position);
      if (d < 12) b.state = 'chase';
      else if (Math.random() < 0.001) b.state = 'wander';

      if (b.state === 'wander') {
        // move random small directions
        if (!b.target || Math.random() < 0.006) {
          b.target = new THREE.Vector3((Math.random() - 0.5) * arenaSize * 0.7, 0, (Math.random() - 0.5) * arenaSize * 0.7);
        }
        const dir = b.target.clone().sub(b.mesh.position);
        dir.y = 0;
        if (dir.length() > 0.6) {
          dir.normalize();
          b.mesh.position.addScaledVector(dir, b.speed * dt / 1000);
          b.mesh.lookAt(b.mesh.position.clone().add(dir));
        }
      } else if (b.state === 'chase') {
        const dir = player.mesh.position.clone().sub(b.mesh.position);
        dir.y = 0;
        if (dir.length() > 1.4) {
          dir.normalize();
          b.mesh.position.addScaledVector(dir, b.speed * dt / 1000);
        }
        // shoot if facing player and cooldown allows
        const aim = player.mesh.position.clone().sub(b.mesh.position);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(b.mesh.quaternion);
        if (aim.length() < 20 && (performance.now() - b.lastShot) > b.shootCooldown) {
          // basic shoot
          const dirShot = aim.normalize();
          const origin = b.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)).add(dirShot.clone().multiplyScalar(1.2));
          shootBullet(origin, dirShot, 'bot');
          b.lastShot = performance.now();
        }
      }
      // clamp in arena
      b.mesh.position.x = Math.max(-arenaSize/2 + 2, Math.min(arenaSize/2 - 2, b.mesh.position.x));
      b.mesh.position.z = Math.max(-arenaSize/2 + 2, Math.min(arenaSize/2 - 2, b.mesh.position.z));
    });
  }

  // bullets update & collisions
  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      const move = b.dir.clone().multiplyScalar(b.speed * dt / 1000);
      b.mesh.position.add(move);
      b.life -= dt;
      // check collisions: with bots or player depending on owner
      if (b.owner === 'player') {
        // hit bots
        for (let j = bots.length - 1; j >= 0; j--) {
          const bot = bots[j];
          if (!bot.alive) continue;
          const dist = bot.mesh.position.distanceTo(b.mesh.position);
          if (dist < 1.4) {
            // hit
            bot.health -= 18;
            spawnHitParticles(b.mesh.position);
            playHitSound();
            if (bot.health <= 0) {
              bot.alive = false;
              scene.remove(bot.mesh);
              bots.splice(j, 1);
              player.score += 100;
              player.kills += 1;
              // chance to drop powerup
              if (Math.random() < 0.35) spawnPowerup(Math.random() < 0.5 ? 'ammo' : 'health', bot.mesh.position.clone());
            }
            scene.remove(b.mesh); bullets.splice(i, 1);
            break;
          }
        }
      } else { // owned by bot
        // hit player
        const dist = player.mesh.position.distanceTo(b.mesh.position);
        if (dist < 1.4 && player.alive) {
          player.health -= 12;
          spawnHitParticles(b.mesh.position);
          scene.remove(b.mesh); bullets.splice(i, 1);
          playHitSound();
          if (player.health <= 0) {
            player.alive = false;
            // death sequence
            player.mesh.material.color.set(0x333333);
            setTimeout(() => {
              // respawn
              player.health = 100; player.mesh.position.set(0, 1.2, 0); player.alive = true; player.mesh.material.color.set(0xffb86b);
            }, 1400);
          }
          continue;
        }
      }
      // world collision (walls)
      if (b.mesh.position.x < -arenaSize/2 || b.mesh.position.x > arenaSize/2 || b.mesh.position.z < -arenaSize/2 || b.mesh.position.z > arenaSize/2) {
        scene.remove(b.mesh); bullets.splice(i, 1);
        continue;
      }
      if (b.life <= 0) {
        scene.remove(b.mesh); bullets.splice(i, 1);
      }
    }
  }

  // hit particles
  const pPool = [];
  function spawnHitParticles(pos) {
    for (let i=0;i<6;i++) {
      const g = new THREE.BoxGeometry(0.08, 0.08, 0.08);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffcc88 }));
      m.position.copy(pos);
      scene.add(m);
      pPool.push({ mesh: m, vel: new THREE.Vector3((Math.random()-0.5)*6, Math.random()*4, (Math.random()-0.5)*6), life: 600 + Math.random()*400 });
    }
  }
  function updateParticles(dt) {
    for (let i = pPool.length - 1; i >= 0; i--) {
      const p = pPool[i];
      p.mesh.position.addScaledVector(p.vel, dt / 1000);
      p.vel.y -= 9.8 * dt / 1000;
      p.life -= dt;
      if (p.life <= 0) {
        scene.remove(p.mesh);
        pPool.splice(i, 1);
      }
    }
  }

  // powerups pickup
  function updatePowerups(dt) {
    for (let i = powerups.length - 1; i >= 0; i--) {
      const pu = powerups[i];
      pu.life -= dt;
      pu.mesh.rotation.y += 0.02;
      if (pu.mesh.position.distanceTo(player.mesh.position) < 1.8) {
        if (pu.type === 'ammo') { player.ammo = Math.min(player.maxAmmo, player.ammo + 12); }
        if (pu.type === 'health') { player.health = Math.min(100, player.health + 30); }
        playPickup();
        scene.remove(pu.mesh);
        powerups.splice(i, 1);
        continue;
      }
      if (pu.life <= 0) { scene.remove(pu.mesh); powerups.splice(i, 1); }
    }
  }

  // hit spawn: small cube burst
  function spawnSmallBurst(pos, color) {
    // not used heavily, kept for future
  }

  // main loop
  function loop() {
    if (!gameRunning) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = Math.min(60, now - lastTime);
    lastTime = now;

    updateColliders();
    updatePlayer(dt);
    updateBots(dt);
    updateBullets(dt);
    updateParticles(dt);
    updatePowerups(dt);

    // spawn powerups occasionally
    accumulatedSpawn += dt;
    if (accumulatedSpawn > 4000 && Math.random() < 0.22) {
      accumulatedSpawn = 0;
      spawnPowerup(Math.random() < 0.6 ? 'ammo' : 'health', new THREE.Vector3((Math.random() - 0.5) * 30, 0.6, (Math.random() - 0.5) * 30));
    }

    // camera follow
    const camTarget = player.mesh.position.clone().add(new THREE.Vector3(0, 3, 0));
    // smooth camera position
    const desiredCamPos = player.mesh.position.clone().add(camOffset.clone().applyQuaternion(player.mesh.quaternion));
    camera.position.lerp(desiredCamPos, 0.08);
    camera.lookAt(camTarget);

    renderer.render(scene, camera);

    // update UI
    updateUI();
  }

  // world init: spawn a few bots for demo
  for (let i = 0; i < botCount; i++) spawnBot();

  // utility: spawn hero bullets from bot & player already implemented

  // Start menu shows by default. small hint: auto-start if you want:
  // startGame();
})();
