import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight,
  EdgesGeometry, GridHelper, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createViewer(container) {
  const scene = new Scene();
  const background = new Color('#202a29');
  scene.background = background;
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D preview');
  container.prepend(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.minZoom = 0.35;
  controls.maxZoom = 5;
  const world = new Group();
  scene.add(world);
  scene.add(new AmbientLight('#ecffe9', 1.6));
  const key = new DirectionalLight('#fffbe4', 2.6);
  key.position.set(-3, -5, 9);
  scene.add(key);
  const fill = new DirectionalLight('#cbe6ec', 0.9);
  fill.position.set(5, 3, 4);
  scene.add(fill);
  const material = new MeshStandardMaterial({ color: '#bedb59', roughness: 0.52 });
  const wireMaterial = new LineBasicMaterial({ color: '#222b16', transparent: true, opacity: 0.67 });
  let span = 100;
  let height = 0;

  function render() {
    renderer.render(scene, camera);
  }
  function resize() {
    const width = container.clientWidth;
    const viewportHeight = container.clientHeight;
    if (!width || !viewportHeight) return;
    const aspect = width / viewportHeight;
    const vertical = span / Math.min(aspect, 1);
    camera.left = -vertical * aspect / 2;
    camera.right = -camera.left;
    camera.bottom = -vertical / 2;
    camera.top = -camera.bottom;
    camera.updateProjectionMatrix();
    renderer.setSize(width, viewportHeight, false);
    render();
  }
  function reset() {
    camera.zoom = 1;
    controls.target.set(0, 0, height / 2);
    camera.position.copy(controls.target).add(new Vector3(1.15, -1.45, 1.13).multiplyScalar(span * 2));
    controls.update();
    resize();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  controls.addEventListener('change', render);

  function setModel(model) {
    for (const item of [...world.children]) {
      item.geometry.dispose();
      if (item.isGridHelper || item.type === 'GridHelper') item.material.dispose();
      world.remove(item);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
    geometry.computeVertexNormals();
    world.add(new Mesh(geometry, material));
    world.add(new LineSegments(new EdgesGeometry(geometry, 25), wireMaterial));
    const longest = Math.max(...model.dimensions);
    height = model.dimensions[2];
    span = Math.max(longest * 1.56, 1);
    const cell = longest >= 60 ? 10 : longest >= 22 ? 5 : longest >= 4 ? 1 : 0.2;
    const grid = new GridHelper(cell * 40, 40, '#677872', '#43514e');
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.02;
    world.add(grid);
    reset();
  }

  return { setModel, reset };
}
