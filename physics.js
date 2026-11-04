/*
 * Pool physics: buoyancy, drag, collisions, pool bounds, coordinate mapping.
 * Pure math with no DOM/WebGL dependencies. Usable as a browser global
 * (window.Physics) and in Node (module.exports).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Physics = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  var Physics = {};

  Physics.POOL_WIDTH = 3;
  Physics.POOL_DEPTH = 4;
  Physics.HALF_W = Physics.POOL_WIDTH / 2;   // 1.5
  Physics.HALF_D = Physics.POOL_DEPTH / 2;   // 2.0
  Physics.POOL_BOTTOM = -1;
  Physics.GRAVITY = 4;
  Physics.WATER_DENSITY = 1;
  Physics.RESTITUTION = 0.7;
  Physics.DRAG = 1.0;
  Physics.LINEAR_DRAG = 5.0;

  Physics.worldToTex = function (x, z) {
    return { u: x / Physics.POOL_WIDTH + 0.5, v: z / Physics.POOL_DEPTH + 0.5 };
  };

  Physics.texToWorld = function (u, v) {
    return { x: (u - 0.5) * Physics.POOL_WIDTH, z: (v - 0.5) * Physics.POOL_DEPTH };
  };

  Physics.sphereVolume = function (r) {
    return (4 / 3) * Math.PI * r * r * r;
  };

  Physics.createBall = function (x, y, z, r, density) {
    var mass = density * Physics.sphereVolume(r);
    return {
      x: x, y: y, z: z,
      vx: 0, vy: 0, vz: 0,
      r: r, density: density, mass: mass,
      prev: { x: x, y: y, z: z }
    };
  };

  Physics.submergedVolume = function (r, y, h) {
    var d = r - (y - h);
    if (d <= 0) return 0;
    if (d >= 2 * r) return Physics.sphereVolume(r);
    return (Math.PI / 3) * d * d * (3 * r - d);
  };

  Physics.verticalAccel = function (ball, h) {
    var vSub = Physics.submergedVolume(ball.r, ball.y, h);
    var vTotal = Physics.sphereVolume(ball.r);
    var ratio = (Physics.WATER_DENSITY * vSub) / (ball.density * vTotal);
    return Physics.GRAVITY * (ratio - 1);
  };

  Physics.stepBall = function (ball, h, vyWater, dt) {
    var vSub = Physics.submergedVolume(ball.r, ball.y, h);
    var vTotal = Physics.sphereVolume(ball.r);
    var f = vSub / vTotal;

    ball.vy += Physics.verticalAccel(ball, h) * dt;

    var speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy + ball.vz * ball.vz);
    var k = Physics.DRAG * f * speed;
    ball.vx -= k * ball.vx * dt;
    ball.vy -= k * ball.vy * dt;
    ball.vz -= k * ball.vz * dt;

    var lin = Physics.LINEAR_DRAG * f;
    ball.vx -= lin * ball.vx * dt;
    ball.vy -= lin * ball.vy * dt;
    ball.vz -= lin * ball.vz * dt;

    ball.vy += (vyWater - ball.vy) * f * dt;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;
    return ball;
  };

  Physics.resolveBallBall = function (a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var minDist = a.r + b.r;
    if (dist >= minDist) return;
    if (dist === 0) {
      dist = minDist * 0.001;
      dx = minDist * 0.001;
      dy = 0;
      dz = 0;
    }
    var nx = dx / dist, ny = dy / dist, nz = dz / dist;
    var invA = 1 / a.mass, invB = 1 / b.mass, invSum = invA + invB;
    var overlap = minDist - dist;

    a.x -= nx * overlap * (invA / invSum);
    a.y -= ny * overlap * (invA / invSum);
    a.z -= nz * overlap * (invA / invSum);
    b.x += nx * overlap * (invB / invSum);
    b.y += ny * overlap * (invB / invSum);
    b.z += nz * overlap * (invB / invSum);

    var relVel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
    if (relVel <= 0) return;
    var j = -(1 + Physics.RESTITUTION) * relVel / invSum;
    a.vx += j * invA * nx; a.vy += j * invA * ny; a.vz += j * invA * nz;
    b.vx -= j * invB * nx; b.vy -= j * invB * ny; b.vz -= j * invB * nz;
  };

  Physics.resolveWall = function (ball) {
    if (ball.x - ball.r < -Physics.HALF_W) {
      ball.x = -Physics.HALF_W + ball.r;
      if (ball.vx < 0) ball.vx = -ball.vx * Physics.RESTITUTION;
    } else if (ball.x + ball.r > Physics.HALF_W) {
      ball.x = Physics.HALF_W - ball.r;
      if (ball.vx > 0) ball.vx = -ball.vx * Physics.RESTITUTION;
    }

    if (ball.z - ball.r < -Physics.HALF_D) {
      ball.z = -Physics.HALF_D + ball.r;
      if (ball.vz < 0) ball.vz = -ball.vz * Physics.RESTITUTION;
    } else if (ball.z + ball.r > Physics.HALF_D) {
      ball.z = Physics.HALF_D - ball.r;
      if (ball.vz > 0) ball.vz = -ball.vz * Physics.RESTITUTION;
    }

    if (ball.y - ball.r < Physics.POOL_BOTTOM) {
      ball.y = Physics.POOL_BOTTOM + ball.r;
      if (ball.vy < 0) ball.vy = -ball.vy * Physics.RESTITUTION;
    }
  };

  return Physics;
});