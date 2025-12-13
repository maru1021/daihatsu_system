// ========================================
// ホームページ Three.js アニメーション
// ========================================

import * as THREE from '/static/js/vendor/three/three.module.js';

// ========================================
// 定数
// ========================================
const CONFIG = {
  camera: {
    fov: 75,
    near: 0.1,
    far: 1000,
    positionZ: 15
  },
  sky: {
    radius: 500,
    widthSegments: 32,
    heightSegments: 15,
    topColor: 0xF8F9FA,
    bottomColor: 0xFFFFFF,
    offset: 33,
    exponent: 0.6
  },
  images: {
    count: 25,
    geometryWidth: 3.5,
    geometryHeight: 3,
    opacity: 1.0,
    radius: 12
  },
  lighting: {
    ambient: { color: 0xffffff, intensity: 1.3 },
    sun: { color: 0xffffee, intensity: 0.6, position: [50, 50, 50] }
  },
  movement: {
    orbit: {
      speed: 0.02,
      radiusWaveSpeed: 0.1,
      radiusWaveAmount: 0.2,
      floatSpeed: 0.2,
      floatAmount: 0.4
    },
    drift: {
      speedX: 0.008,
      speedY: 0.006,
      speedZ: 0.003,
      waveSpeedRange: [0.1, 0.25],
      waveRangeX: [0.8, 2.3],
      waveRangeY: [0.6, 1.8]
    },
    camera: {
      speedX: 0.1,
      speedY: 0.08,
      rangeX: 2,
      rangeY: 1.5
    }
  }
};

// 画像パスはDjangoのstaticタグで注入されるため、
// HTMLから取得（window.IMAGE_PATHS）

// ========================================
// Three.js シーン初期化
// ========================================
class HomeScene {
  constructor(canvasId, loadingId) {
    this.canvas = document.getElementById(canvasId);
    this.loading = document.getElementById(loadingId);
    this.scene = new THREE.Scene();
    this.meshes = [];
    this.time = 0;

    this.initRenderer();
    this.initCamera();
    this.initSky();
    this.initLights();
    this.loadImages();
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
  }

  initCamera() {
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      CONFIG.camera.near,
      CONFIG.camera.far
    );
    this.camera.position.z = CONFIG.camera.positionZ;
    this.camera.lookAt(0, 0, 0);
  }

  initSky() {
    const skyGeo = new THREE.SphereGeometry(
      CONFIG.sky.radius,
      CONFIG.sky.widthSegments,
      CONFIG.sky.heightSegments
    );

    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(CONFIG.sky.topColor) },
        bottomColor: { value: new THREE.Color(CONFIG.sky.bottomColor) },
        offset: { value: CONFIG.sky.offset },
        exponent: { value: CONFIG.sky.exponent }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;

        void main() {
          float h = normalize(vWorldPosition + offset).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide
    });

    const sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(sky);
  }

  initLights() {
    // アンビエントライト
    const ambientLight = new THREE.AmbientLight(
      CONFIG.lighting.ambient.color,
      CONFIG.lighting.ambient.intensity
    );
    this.scene.add(ambientLight);

    // 太陽光
    const sunLight = new THREE.DirectionalLight(
      CONFIG.lighting.sun.color,
      CONFIG.lighting.sun.intensity
    );
    sunLight.position.set(...CONFIG.lighting.sun.position);
    this.scene.add(sunLight);
  }

  loadImages() {
    const textureLoader = new THREE.TextureLoader();
    let loadedCount = 0;

    // ランダムに画像を選択
    const selectedImages = this.selectRandomImages(CONFIG.images.count);

    if (selectedImages.length === 0) {
      this.loading.style.display = 'none';
      return;
    }

    selectedImages.forEach((path, index) => {
      textureLoader.load(
        path,
        (texture) => {
          const mesh = this.createImageMesh(texture, index, selectedImages.length);
          this.scene.add(mesh);
          this.meshes.push(mesh);

          loadedCount++;
          if (loadedCount === selectedImages.length) {
            this.loading.style.display = 'none';
          }
        },
        undefined,
        (error) => {
          console.error('Failed to load image:', path, error);
          loadedCount++;
          if (loadedCount === selectedImages.length) {
            this.loading.style.display = 'none';
          }
        }
      );
    });
  }

  selectRandomImages(count) {
    const selected = [];
    const imagePaths = window.IMAGE_PATHS || [];

    if (imagePaths.length === 0) {
      return selected;
    }

    for (let i = 0; i < count; i++) {
      const randomIndex = Math.floor(Math.random() * imagePaths.length);
      selected.push(imagePaths[randomIndex]);
    }
    return selected;
  }

  createImageMesh(texture, index, total) {
    const geometry = new THREE.PlaneGeometry(
      CONFIG.images.geometryWidth,
      CONFIG.images.geometryHeight
    );

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: CONFIG.images.opacity
    });

    const mesh = new THREE.Mesh(geometry, material);

    // 初期位置
    const angle = (index / total) * Math.PI * 2;
    const radius = CONFIG.images.radius;
    const x = Math.cos(angle) * radius;
    const y = (Math.random() - 0.5) * 8;
    const z = Math.sin(angle) * radius;

    mesh.position.set(x, y, z);
    mesh.rotation.set(0, 0, 0);

    // 動きのタイプ (0: 円形, 1: 横, 2: 縦, 3: 斜め)
    const movementType = Math.floor(Math.random() * 4);

    // アニメーション用のカスタムデータ
    mesh.userData = {
      originalX: x,
      originalY: y,
      originalZ: z,
      angle: angle,
      radius: radius,
      movementType: movementType,
      floatSpeed: Math.random() * 0.0008 + 0.0005,
      floatOffset: Math.random() * Math.PI * 2,
      driftSpeedX: (Math.random() - 0.5) * CONFIG.movement.drift.speedX,
      driftSpeedY: (Math.random() - 0.5) * CONFIG.movement.drift.speedY,
      driftSpeedZ: (Math.random() - 0.5) * CONFIG.movement.drift.speedZ,
      waveSpeedX: Math.random() * 0.15 + 0.1,
      waveSpeedY: Math.random() * 0.12 + 0.08,
      waveRangeX: Math.random() * 1.5 + 0.8,
      waveRangeY: Math.random() * 1.2 + 0.6
    };

    return mesh;
  }

  updateMeshPositions() {
    this.meshes.forEach((mesh) => {
      const userData = mesh.userData;

      switch(userData.movementType) {
        case 0: // 円形軌道
          this.updateOrbitMovement(mesh, userData);
          break;
        case 1: // 横移動
          this.updateHorizontalDrift(mesh, userData);
          break;
        case 2: // 縦移動
          this.updateVerticalDrift(mesh, userData);
          break;
        case 3: // 斜め移動
          this.updateDiagonalDrift(mesh, userData);
          break;
      }
    });
  }

  updateOrbitMovement(mesh, userData) {
    const newAngle = userData.angle + this.time * CONFIG.movement.orbit.speed;
    const radiusWave = Math.sin(this.time * CONFIG.movement.orbit.radiusWaveSpeed + userData.floatOffset)
                       * CONFIG.movement.orbit.radiusWaveAmount;
    const currentRadius = userData.radius + radiusWave;

    mesh.position.x = Math.cos(newAngle) * currentRadius;
    mesh.position.z = Math.sin(newAngle) * currentRadius;

    const floatY = Math.sin(this.time * CONFIG.movement.orbit.floatSpeed + userData.floatOffset)
                   * CONFIG.movement.orbit.floatAmount;
    mesh.position.y = userData.originalY + floatY;
  }

  updateHorizontalDrift(mesh, userData) {
    userData.originalX += userData.driftSpeedX;
    userData.originalZ += userData.driftSpeedZ * 0.3;

    const waveX = Math.sin(this.time * userData.waveSpeedX + userData.floatOffset) * userData.waveRangeX;
    const waveY = Math.sin(this.time * userData.waveSpeedY + userData.floatOffset) * userData.waveRangeY;

    mesh.position.x = userData.originalX + waveX;
    mesh.position.y = userData.originalY + waveY;
    mesh.position.z = userData.originalZ;
  }

  updateVerticalDrift(mesh, userData) {
    userData.originalY += userData.driftSpeedY;
    userData.originalZ += userData.driftSpeedZ * 0.3;

    const waveX = Math.sin(this.time * userData.waveSpeedX + userData.floatOffset) * userData.waveRangeX;
    const waveY = Math.sin(this.time * userData.waveSpeedY + userData.floatOffset) * userData.waveRangeY * 0.5;

    mesh.position.x = userData.originalX + waveX;
    mesh.position.y = userData.originalY + waveY;
    mesh.position.z = userData.originalZ;
  }

  updateDiagonalDrift(mesh, userData) {
    userData.originalX += userData.driftSpeedX;
    userData.originalY += userData.driftSpeedY;
    userData.originalZ += userData.driftSpeedZ * 0.3;

    const waveX = Math.sin(this.time * userData.waveSpeedX + userData.floatOffset) * userData.waveRangeX;
    const waveY = Math.sin(this.time * userData.waveSpeedY + userData.floatOffset) * userData.waveRangeY;

    mesh.position.x = userData.originalX + waveX;
    mesh.position.y = userData.originalY + waveY;
    mesh.position.z = userData.originalZ;
  }

  updateCamera() {
    this.camera.position.x = Math.sin(this.time * CONFIG.movement.camera.speedX) * CONFIG.movement.camera.rangeX;
    this.camera.position.y = Math.cos(this.time * CONFIG.movement.camera.speedY) * CONFIG.movement.camera.rangeY;
    this.camera.lookAt(0, 0, 0);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.time += 0.01;

    this.updateMeshPositions();
    this.updateCamera();

    this.renderer.render(this.scene, this.camera);
  }


  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start() {
    this.animate();
    window.addEventListener('resize', () => this.handleResize());
  }
}

// ========================================
// 初期化
// ========================================
function initHomeScene() {
  // 必要な要素が存在するか確認
  const canvas = document.getElementById('three-canvas');
  const loading = document.getElementById('loading');

  if (!canvas || !loading) {
    console.error('Required elements not found: three-canvas or loading');
    return;
  }

  // window.IMAGE_PATHSが設定されているか確認
  if (!window.IMAGE_PATHS || !Array.isArray(window.IMAGE_PATHS)) {
    console.error('window.IMAGE_PATHS is not defined or not an array');
    return;
  }

  // シーンを初期化して開始
  const homeScene = new HomeScene('three-canvas', 'loading');
  homeScene.start();
}

// DOMContentLoadedイベントで初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHomeScene);
} else {
  // すでにDOMが読み込まれている場合は即座に実行
  initHomeScene();
}
