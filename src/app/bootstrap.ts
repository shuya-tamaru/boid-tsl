import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  abs,
  float,
  Fn,
  hash,
  If,
  instancedArray,
  instanceIndex,
  positionLocal,
  uniform,
  vec3,
  transformDirection,
  normalize,
  dot,
  cross,
  acos,
  cos,
  sin,
  mat3,
  Loop,
  uint,
} from "three/tsl";
export function bootstrap() {
  //setup
  let width = window.innerWidth;
  let height = window.innerHeight;
  let aspect = width / height;

  //scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#333");

  //camera
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.y = 10;
  camera.position.z = 60;

  //renderer
  const renderer = new THREE.WebGPURenderer();
  renderer.setSize(width, height);
  document.body.appendChild(renderer.domElement);

  //controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 500;

  //box
  const bWidth = uniform(25);
  const bHeight = uniform(25);
  const bDepth = uniform(25);
  const boxGeometry = new THREE.BoxGeometry(
    bWidth.value,
    bHeight.value,
    bDepth.value
  );
  const boxMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0xffffff,
    transparent: true,
    side: THREE.DoubleSide,
  });
  boxMaterial.opacityNode = Fn(() => {
    const edgeWidth = float(0.1);
    const isXEdge = abs(positionLocal.x).greaterThan(
      bWidth.div(2).sub(edgeWidth)
    );
    const isYEdge = abs(positionLocal.y).greaterThan(
      bHeight.div(2).sub(edgeWidth)
    );
    const isZEdge = abs(positionLocal.z).greaterThan(
      bDepth.div(2).sub(edgeWidth)
    );
    const edgeXY = isXEdge.and(isYEdge);
    const edgeXZ = isXEdge.and(isZEdge);
    const edgeYZ = isYEdge.and(isZEdge);
    const isEdge = edgeXY.or(edgeXZ).or(edgeYZ);
    return isEdge.select(float(1), float(0));
  })();

  const mesh = new THREE.Mesh(boxGeometry, boxMaterial);
  scene.add(mesh);

  //paramas
  // パラメータを調整
  const speed = uniform(10.0); // 基本速度を上げる
  const maxSpeed = uniform(6.0); // maxSpeedを適切に設定
  const timeStep = uniform(1 / 100);

  // 各力の強度を調整
  const cohesionStrength = float(0.3); // 弱く
  const alignmentStrength = float(0.4); // 中程度
  const separationStrength = float(0.8);

  const separationRadius = uniform(2.0);
  const alignmentRadius = uniform(0.3);

  //bird
  const birdsCount = 20;
  const coneGeometry = new THREE.ConeGeometry(0.1, 1, 4);
  const coneMaterial = new THREE.MeshBasicNodeMaterial({
    color: "yellow",
    transparent: true,
    side: THREE.DoubleSide,
  });

  const positionBuffer = instancedArray(birdsCount, "vec3");
  const velocityBuffer = instancedArray(birdsCount, "vec3");
  const birdsCenterBuffer = instancedArray(1, "vec3");
  const cohesionForceBuffer = instancedArray(birdsCount, "vec3");
  const alignmentForceBuffer = instancedArray(birdsCount, "vec3");
  const separationForceBuffer = instancedArray(birdsCount, "vec3");

  //@ts-ignore
  const rotateMat = Fn(([axis, angle]) => {
    const c = cos(angle);
    const s = sin(angle);
    const t = float(1).sub(c);

    const x = axis.x;
    const y = axis.y;
    const z = axis.z;

    const m00 = t.mul(x).mul(x).add(c);
    const m01 = t.mul(x).mul(y).sub(s.mul(z));
    const m02 = t.mul(x).mul(z).add(s.mul(y));
    const m10 = t.mul(x).mul(y).add(s.mul(z));
    const m11 = t.mul(y).mul(y).add(c);
    const m12 = t.mul(y).mul(z).sub(s.mul(x));
    const m20 = t.mul(x).mul(z).sub(s.mul(y));
    const m21 = t.mul(y).mul(z).add(s.mul(x));
    const m22 = t.mul(z).mul(z).add(c);

    //@ts-ignore
    return mat3(m00, m01, m02, m10, m11, m12, m20, m21, m22);
  });

  const initialize = Fn(() => {
    const position = positionBuffer.element(instanceIndex);
    const x = hash(instanceIndex.mul(1664525)).sub(0.5).mul(bWidth);
    const y = hash(instanceIndex.mul(22695477)).sub(0.5).mul(bHeight);
    const z = hash(instanceIndex.mul(747796405)).sub(0.5).mul(bDepth);
    const initialPosition = vec3(x, y, z);
    position.assign(initialPosition);

    const velocity = velocityBuffer.element(instanceIndex);
    const vx = hash(instanceIndex.mul(1664525).add(1)).sub(0.5).mul(speed);
    const vy = hash(instanceIndex.mul(22695477).add(1)).sub(0.5).mul(speed);
    const vz = hash(instanceIndex.mul(747796405).add(1)).sub(0.5).mul(speed);
    const initialVelocity = vec3(vx, vy, vz);
    velocity.assign(initialVelocity);
  });
  const computeInitialize = initialize().compute(birdsCount);
  renderer.computeAsync(computeInitialize);

  coneMaterial.positionNode = Fn(() => {
    const positionAttr = positionBuffer.element(instanceIndex);
    const velocityAttr = velocityBuffer.element(instanceIndex);
    const velocityDir = normalize(velocityAttr);
    const forward = vec3(0, 1, 0);
    const angle = acos(dot(forward, velocityDir));
    const axis = normalize(cross(forward, velocityDir));

    //@ts-ignore
    const rotMat = rotateMat(axis, angle);
    const rotated = transformDirection(positionLocal, rotMat);

    return rotated.add(positionAttr);
  })();

  const computeBoidCenter = Fn(() => {
    // 群衆の中心を更新
    If(instanceIndex.equal(0), () => {
      const birdsCenter = birdsCenterBuffer.element(0);
      let center = vec3(0, 0, 0);
      const i = uint(0);
      Loop(birdsCount, () => {
        center.assign(center.add(positionBuffer.element(i)));
        i.assign(i.add(1));
      });
      center.assign(center.div(birdsCount));
      birdsCenter.assign(center);
    });
  });
  const computeUpdateBoidCenter = computeBoidCenter().compute(birdsCount);

  const computeCohesion = Fn(() => {
    const position = positionBuffer.element(instanceIndex);
    // 群衆の中心を取得
    const flockCenter = birdsCenterBuffer.element(0);
    const toCenter = flockCenter.sub(position);
    const toCenterNormalized = normalize(toCenter);

    const cohesionForce = toCenterNormalized;
    cohesionForceBuffer.element(instanceIndex).assign(cohesionForce);
  });
  const computeUpdateCohesion = computeCohesion().compute(birdsCount);

  const computeAlignment = Fn(() => {
    const position = positionBuffer.element(instanceIndex);
    const velocity = velocityBuffer.element(instanceIndex);
    const averageVelocity = vec3(0, 0, 0);
    const count = float(0);

    const i = uint(0).toVar();
    Loop(i.lessThan(birdsCount), () => {
      If(i.notEqual(instanceIndex), () => {
        const otherPosition = positionBuffer.element(i);
        const distance = position.sub(otherPosition).length();

        If(distance.lessThan(alignmentRadius), () => {
          const otherVelocity = velocityBuffer.element(i);
          averageVelocity.assign(averageVelocity.add(otherVelocity));
          count.assign(count.add(1));
        });
      });
      i.assign(i.add(1));
    });
    const alignmentForce = count
      .greaterThan(0)
      .select(
        normalize(averageVelocity.div(count)).sub(normalize(velocity)),
        vec3(0)
      );

    alignmentForceBuffer.element(instanceIndex).assign(alignmentForce);
  });

  const computeUpdateAlignment = computeAlignment().compute(birdsCount);

  const computeSeparation = Fn(() => {
    const position = positionBuffer.element(instanceIndex);
    const separationForce = vec3(0, 0, 0);
    const currentMinDistance = float(1000);
    const i = uint(0).toVar();
    Loop(i.lessThan(birdsCount), () => {
      If(i.notEqual(instanceIndex), () => {
        const otherPosition = positionBuffer.element(i);
        const diff = position.sub(otherPosition);
        const distance = diff.length();
        If(
          distance
            .lessThan(separationRadius)
            .and(distance.greaterThan(0))
            .and(distance.lessThan(currentMinDistance)),
          () => {
            currentMinDistance.assign(distance);
            const force = normalize(diff).div(distance);
            separationForce.assign(force);
          }
        );
      });
      i.assign(i.add(1));
    });
    separationForceBuffer.element(instanceIndex).assign(separationForce);
  });
  const computeUpdateSeparation = computeSeparation().compute(birdsCount);

  const computeIntegrate = Fn(() => {
    const position = positionBuffer.element(instanceIndex);
    const velocity = velocityBuffer.element(instanceIndex);

    const cohesionForce = cohesionForceBuffer
      .element(instanceIndex)
      .mul(cohesionStrength);
    const alignmentForce = alignmentForceBuffer
      .element(instanceIndex)
      .mul(alignmentStrength);
    const separationForce = separationForceBuffer
      .element(instanceIndex)
      .mul(separationStrength);

    const totalForce = cohesionForce.add(alignmentForce).add(separationForce);

    const newVelocity = velocity.add(totalForce);
    const velocityLength = newVelocity.length();
    const clampedVelocity = velocityLength.greaterThan(maxSpeed).select(
      normalize(newVelocity).mul(maxSpeed), // 最大速度に制限
      newVelocity // そのまま
    );
    const newPosition = position.add(clampedVelocity.mul(timeStep).mul(speed));

    If(newPosition.x.lessThan(bWidth.mul(-1).div(2)), () => {
      newPosition.x.assign(bWidth.mul(-1).div(2));
      clampedVelocity.x.assign(clampedVelocity.x.mul(-1));
    }).ElseIf(newPosition.x.greaterThan(bWidth.div(2)), () => {
      newPosition.x.assign(bWidth.div(2));
      clampedVelocity.x.assign(clampedVelocity.x.mul(-1));
    });
    If(newPosition.y.lessThan(bHeight.mul(-1).div(2)), () => {
      newPosition.y.assign(bHeight.mul(-1).div(2));
      clampedVelocity.y.assign(clampedVelocity.y.mul(-1));
    }).ElseIf(newPosition.y.greaterThan(bHeight.div(2)), () => {
      newPosition.y.assign(bHeight.div(2));
      clampedVelocity.y.assign(clampedVelocity.y.mul(-1));
    });
    If(newPosition.z.lessThan(bDepth.mul(-1).div(2)), () => {
      newPosition.z.assign(bDepth.mul(-1).div(2));
      clampedVelocity.z.assign(clampedVelocity.z.mul(-1));
    }).ElseIf(newPosition.z.greaterThan(bDepth.div(2)), () => {
      newPosition.z.assign(bDepth.div(2));
      clampedVelocity.z.assign(clampedVelocity.z.mul(-1));
    });

    position.assign(newPosition);
    velocity.assign(clampedVelocity);
  });

  const computeUpdateIntegrate = computeIntegrate().compute(birdsCount);

  const coneMesh = new THREE.InstancedMesh(
    coneGeometry,
    coneMaterial,
    birdsCount
  );
  scene.add(coneMesh);

  window.addEventListener("resize", () => {
    aspect = window.innerWidth / window.innerHeight;

    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  async function animate() {
    requestAnimationFrame(animate);
    await renderer.computeAsync(computeUpdateBoidCenter);
    await renderer.computeAsync(computeUpdateCohesion);
    await renderer.computeAsync(computeUpdateAlignment);
    await renderer.computeAsync(computeUpdateSeparation);
    await renderer.computeAsync(computeUpdateIntegrate);

    controls.update();
    renderer.renderAsync(scene, camera);
  }
  animate();
}
