/*
 * WebGL Water
 * https://madebyevan.com/webgl-water/
 *
 * Copyright 2011 Evan Wallace
 * Released under the MIT license
 */

function text2html(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function handleError(text) {
  var html = text2html(text);
  if (html == 'WebGL not supported') {
    html = 'Your browser does not support WebGL.<br>Please see\
    <a href="https://get.webgl.org/get-a-webgl-implementation/">\
    Getting a WebGL Implementation</a>.';
  }
  var loading = document.getElementById('loading');
  loading.innerHTML = html;
  loading.style.zIndex = 1;
}

window.onerror = handleError;

var gl = GL.create();
var water;
var cubemap;
var renderer;
var angleX = -90;
var angleY = 0;
var CAMERA_DISTANCE = 6;
var paused = false;

var balls = [];
var DROP_RADIUS = 0.06;

window.onload = function() {
  var ratio = window.devicePixelRatio || 1;

  function onresize() {
    var width = innerWidth;
    var height = innerHeight;
    gl.canvas.width = width * ratio;
    gl.canvas.height = height * ratio;
    gl.canvas.style.width = width + 'px';
    gl.canvas.style.height = height + 'px';
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.matrixMode(gl.PROJECTION);
    gl.loadIdentity();
    gl.perspective(45, gl.canvas.width / gl.canvas.height, 0.01, 100);
    gl.matrixMode(gl.MODELVIEW);
    draw();
  }

  document.body.appendChild(gl.canvas);
  gl.clearColor(0, 0, 0, 1);

  water = new Water();
  renderer = new Renderer();
  cubemap = new Cubemap({
    xneg: document.getElementById('xneg'),
    xpos: document.getElementById('xpos'),
    yneg: document.getElementById('ypos'),
    ypos: document.getElementById('ypos'),
    zneg: document.getElementById('zneg'),
    zpos: document.getElementById('zpos')
  });

  if (!water.textureA.canDrawTo() || !water.textureB.canDrawTo()) {
    throw new Error('Rendering to floating-point textures is required but not supported');
  }

  balls = [
    Physics.createBall(-0.5, 0.3, -0.6, 0.25, 0.5),
    Physics.createBall(0.4, 0.6, 0.3, 0.22, 0.45),
    Physics.createBall(0.0, 0.4, -0.2, 0.18, 0.4)
  ];

  for (var i = 0; i < 20; i++) {
    water.addDrop(Math.random() * Physics.POOL_WIDTH - Physics.HALF_W, Math.random() * Physics.POOL_DEPTH - Physics.HALF_D, 0.03, (i & 1) ? 0.01 : -0.01);
  }

  document.getElementById('loading').innerHTML = '';
  onresize();

  var requestAnimationFrame =
    window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    function(callback) { setTimeout(callback, 0); };

  var prevTime = new Date().getTime();
  function animate() {
    var nextTime = new Date().getTime();
    if (!paused) {
      update((nextTime - prevTime) / 1000);
      draw();
    }
    prevTime = nextTime;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  window.onresize = onresize;

  var prevHit;
  var planeNormal;
  var mode = -1;
  var dragBall = -1;
  var MODE_ADD_DROPS = 0;
  var MODE_MOVE_SPHERE = 1;
  var MODE_ORBIT_CAMERA = 2;

  var oldX, oldY;

  function startDrag(x, y) {
    oldX = x;
    oldY = y;
    var tracer = new GL.Raytracer();
    var ray = tracer.getRayForPixel(x * ratio, y * ratio);
    var pointOnPlane = tracer.eye.add(ray.multiply(-tracer.eye.y / ray.y));
    var nearestT = Infinity;
    dragBall = -1;
    for (var i = 0; i < balls.length; i++) {
      var hit = GL.Raytracer.hitTestSphere(tracer.eye, ray, new GL.Vector(balls[i].x, balls[i].y, balls[i].z), balls[i].r);
      if (hit && hit.t < nearestT) {
        nearestT = hit.t;
        dragBall = i;
        prevHit = hit.hit;
      }
    }
    if (dragBall >= 0) {
      mode = MODE_MOVE_SPHERE;
      planeNormal = tracer.getRayForPixel(gl.canvas.width / 2, gl.canvas.height / 2).negative();
    } else if (Math.abs(pointOnPlane.x) < Physics.HALF_W && Math.abs(pointOnPlane.z) < Physics.HALF_D) {
      mode = MODE_ADD_DROPS;
      duringDrag(x, y);
    } else {
      mode = MODE_ORBIT_CAMERA;
    }
  }

  function duringDrag(x, y) {
    switch (mode) {
      case MODE_ADD_DROPS: {
        var tracer = new GL.Raytracer();
        var ray = tracer.getRayForPixel(x * ratio, y * ratio);
        var pointOnPlane = tracer.eye.add(ray.multiply(-tracer.eye.y / ray.y));
        water.addDrop(pointOnPlane.x, pointOnPlane.z, DROP_RADIUS, 0.01);
        if (paused) {
          water.updateNormals();
          renderer.updateCaustics(water);
        }
        break;
      }
      case MODE_MOVE_SPHERE: {
        var tracer = new GL.Raytracer();
        var ray = tracer.getRayForPixel(x * ratio, y * ratio);
        var t = -planeNormal.dot(tracer.eye.subtract(prevHit)) / planeNormal.dot(ray);
        var nextHit = tracer.eye.add(ray.multiply(t));
        var ball = balls[dragBall];
        ball.x += nextHit.x - prevHit.x;
        ball.y += nextHit.y - prevHit.y;
        ball.z += nextHit.z - prevHit.z;
        ball.x = Math.max(ball.r - Physics.HALF_W, Math.min(Physics.HALF_W - ball.r, ball.x));
        ball.y = Math.max(ball.r + Physics.POOL_BOTTOM, Math.min(10, ball.y));
        ball.z = Math.max(ball.r - Physics.HALF_D, Math.min(Physics.HALF_D - ball.r, ball.z));
        prevHit = nextHit;
        if (paused) renderer.updateCaustics(water);
        break;
      }
      case MODE_ORBIT_CAMERA: {
        angleY -= x - oldX;
        angleX -= y - oldY;
        angleX = Math.max(-89.999, Math.min(89.999, angleX));
        break;
      }
    }
    oldX = x;
    oldY = y;
    if (paused) draw();
  }

  function stopDrag() {
    mode = -1;
    dragBall = -1;
  }

  document.onmousedown = function(e) {
    e.preventDefault();
    startDrag(e.pageX, e.pageY);
  };

  document.onmousemove = function(e) {
    duringDrag(e.pageX, e.pageY);
  };

  document.onmouseup = function() {
    stopDrag();
  };

  document.ontouchstart = function(e) {
    if (e.touches.length === 1) {
      e.preventDefault();
      startDrag(e.touches[0].pageX, e.touches[0].pageY);
    }
  };

  document.ontouchmove = function(e) {
    if (e.touches.length === 1) {
      duringDrag(e.touches[0].pageX, e.touches[0].pageY);
    }
  };

  document.ontouchend = function(e) {
    if (e.touches.length == 0) {
      stopDrag();
    }
  };

  document.onkeydown = function(e) {
    if (e.which == ' '.charCodeAt(0)) paused = !paused;
  };

  function update(seconds) {
    if (seconds > 1) return;

    water.updateHeightField();

    for (var i = 0; i < balls.length; i++) {
      var ball = balls[i];
      if (i === dragBall && mode === MODE_MOVE_SPHERE) {
        var invDt = 1 / Math.max(seconds, 0.001);
        ball.vx = (ball.x - ball.prev.x) * invDt;
        ball.vy = (ball.y - ball.prev.y) * invDt;
        ball.vz = (ball.z - ball.prev.z) * invDt;
      } else {
        Physics.stepBall(ball, water.sampleHeight(ball.x, ball.z), seconds);
      }
    }

    for (var i = 0; i < balls.length; i++) {
      for (var j = i + 1; j < balls.length; j++) {
        Physics.resolveBallBall(balls[i], balls[j]);
      }
    }

    for (var i = 0; i < balls.length; i++) {
      Physics.resolveWall(balls[i]);
    }

    for (var i = 0; i < balls.length; i++) {
      var ball = balls[i];
      water.moveSphere(ball.prev, ball, ball.r);
      ball.prev = { x: ball.x, y: ball.y, z: ball.z };
    }

    water.stepSimulation();
    water.stepSimulation();
    water.updateNormals();
    renderer.updateCaustics(water);
  }

  function draw() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.loadIdentity();
    gl.translate(0, 0, -CAMERA_DISTANCE);
    gl.rotate(-angleX, 1, 0, 0);
    gl.rotate(-angleY, 0, 1, 0);

    gl.enable(gl.DEPTH_TEST);
    renderer.renderCube();
    renderer.renderWater(water, cubemap);
    for (var i = 0; i < balls.length; i++) {
      renderer.renderSphere(balls[i].x, balls[i].y, balls[i].z, balls[i].r);
    }
    gl.disable(gl.DEPTH_TEST);
  }
};