/*
 * WebGL Water
 * https://madebyevan.com/webgl-water/
 *
 * Copyright 2011 Evan Wallace
 * Released under the MIT license
 */

// The data in the texture is (position.y, velocity.y, normal.x, normal.z)
function Water() {
  var vertexShader = '\
    varying vec2 coord;\
    void main() {\
      coord = gl_Vertex.xy * 0.5 + 0.5;\
      gl_Position = vec4(gl_Vertex.xyz, 1.0);\
    }\
  ';
  this.plane = GL.Mesh.plane();
  if (!GL.Texture.canUseFloatingPointTextures()) {
    throw new Error('This demo requires the OES_texture_float extension');
  }
  var filter = GL.Texture.canUseFloatingPointLinearFiltering() ? gl.LINEAR : gl.NEAREST;
  this.textureA = new GL.Texture(256, 256, { type: gl.FLOAT, filter: filter });
  this.textureB = new GL.Texture(256, 256, { type: gl.FLOAT, filter: filter });
  if ((!this.textureA.canDrawTo() || !this.textureB.canDrawTo()) && GL.Texture.canUseHalfFloatingPointTextures()) {
    filter = GL.Texture.canUseHalfFloatingPointLinearFiltering() ? gl.LINEAR : gl.NEAREST;
    this.textureA = new GL.Texture(256, 256, { type: gl.HALF_FLOAT_OES, filter: filter });
    this.textureB = new GL.Texture(256, 256, { type: gl.HALF_FLOAT_OES, filter: filter });
  }
  this.dropShader = new GL.Shader(vertexShader, '\
    const float PI = 3.141592653589793;\
    const float HALF_W = ' + Physics.HALF_W + ';\
    const float HALF_D = ' + Physics.HALF_D + ';\
    uniform sampler2D texture;\
    uniform vec2 center;\
    uniform float radius;\
    uniform float strength;\
    varying vec2 coord;\
    void main() {\
      /* get vertex info */\
      vec4 info = texture2D(texture, coord);\
      \
      /* add the drop to the height (world-space elliptical drop) */\
      vec2 world = vec2((coord.x - 0.5) * 2.0 * HALF_W, (coord.y - 0.5) * 2.0 * HALF_D);\
      float drop = max(0.0, 1.0 - length(world - center) / radius);\
      drop = 0.5 - cos(drop * PI) * 0.5;\
      info.r += drop * strength;\
      \
      gl_FragColor = info;\
    }\
  ');
  this.updateShader = new GL.Shader(vertexShader, '\
    uniform sampler2D texture;\
    uniform vec2 delta;\
    varying vec2 coord;\
    void main() {\
      /* get vertex info */\
      vec4 info = texture2D(texture, coord);\
      \
      /* calculate average neighbor height */\
      vec2 dx = vec2(delta.x, 0.0);\
      vec2 dy = vec2(0.0, delta.y);\
      float average = (\
        texture2D(texture, coord - dx).r +\
        texture2D(texture, coord - dy).r +\
        texture2D(texture, coord + dx).r +\
        texture2D(texture, coord + dy).r\
      ) * 0.25;\
      \
      /* change the velocity to move toward the average */\
      info.g += (average - info.r) * 2.0;\
      \
      /* attenuate the velocity a little so waves do not last forever */\
      info.g *= 0.995;\
      \
      /* move the vertex along the velocity */\
      info.r += info.g;\
      \
      gl_FragColor = info;\
    }\
  ');
  this.normalShader = new GL.Shader(vertexShader, '\
    uniform sampler2D texture;\
    uniform vec2 delta;\
    varying vec2 coord;\
    void main() {\
      /* get vertex info */\
      vec4 info = texture2D(texture, coord);\
      \
      /* update the normal */\
      vec3 dx = vec3(delta.x, texture2D(texture, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);\
      vec3 dy = vec3(0.0, texture2D(texture, vec2(coord.x, coord.y + delta.y)).r - info.r, delta.y);\
      info.ba = normalize(cross(dy, dx)).xz;\
      \
      gl_FragColor = info;\
    }\
  ');
  this.sphereShader = new GL.Shader(vertexShader, '\
    const float HALF_W = ' + Physics.HALF_W + ';\
    const float HALF_D = ' + Physics.HALF_D + ';\
    uniform sampler2D texture;\
    uniform vec3 oldCenter;\
    uniform vec3 newCenter;\
    uniform float radius;\
    varying vec2 coord;\
    \
    float volumeInSphere(vec3 center) {\
      vec3 world = vec3((coord.x - 0.5) * 2.0 * HALF_W, 0.0, (coord.y - 0.5) * 2.0 * HALF_D);\
      vec3 toCenter = world - center;\
      float t = length(toCenter) / radius;\
      float dy = exp(-pow(t * 1.5, 6.0));\
      float ymin = min(0.0, center.y - dy);\
      float ymax = min(max(0.0, center.y + dy), ymin + 2.0 * dy);\
      return (ymax - ymin) * 0.1;\
    }\
    \
    void main() {\
      /* get vertex info */\
      vec4 info = texture2D(texture, coord);\
      \
      /* add the old volume */\
      info.r += volumeInSphere(oldCenter);\
      \
      /* subtract the new volume */\
      info.r -= volumeInSphere(newCenter);\
      \
      gl_FragColor = info;\
    }\
  ');
  this.heightTex = new GL.Texture(64, 64, { type: gl.FLOAT, filter: gl.LINEAR });
  this.heightData = new Float32Array(64 * 64 * 4);
  this.downsampleShader = new GL.Shader(vertexShader, '\
    uniform sampler2D texture;\
    varying vec2 coord;\
    void main() {\
      gl_FragColor = texture2D(texture, coord);\
    }\
  ');
}

Water.prototype.addDrop = function(x, y, radius, strength) {
  var this_ = this;
  this.textureB.drawTo(function() {
    this_.textureA.bind();
    this_.dropShader.uniforms({
      center: [x, y],
      radius: radius,
      strength: strength
    }).draw(this_.plane);
  });
  this.textureB.swapWith(this.textureA);
};

Water.prototype.moveSphere = function(oldCenter, newCenter, radius) {
  var this_ = this;
  this.textureB.drawTo(function() {
    this_.textureA.bind();
    this_.sphereShader.uniforms({
      oldCenter: [oldCenter.x, oldCenter.y, oldCenter.z],
      newCenter: [newCenter.x, newCenter.y, newCenter.z],
      radius: radius
    }).draw(this_.plane);
  });
  this.textureB.swapWith(this.textureA);
};

Water.prototype.stepSimulation = function() {
  var this_ = this;
  this.textureB.drawTo(function() {
    this_.textureA.bind();
    this_.updateShader.uniforms({
      delta: [1 / this_.textureA.width, 1 / this_.textureA.height]
    }).draw(this_.plane);
  });
  this.textureB.swapWith(this.textureA);
};

Water.prototype.updateNormals = function() {
  var this_ = this;
  this.textureB.drawTo(function() {
    this_.textureA.bind();
    this_.normalShader.uniforms({
      delta: [1 / this_.textureA.width, 1 / this_.textureA.height]
    }).draw(this_.plane);
  });
  this.textureB.swapWith(this.textureA);
};

Water.prototype.updateHeightField = function() {
  var this_ = this;
  this.heightTex.drawTo(function() {
    this_.textureA.bind();
    this_.downsampleShader.uniforms({ texture: 0 }).draw(this_.plane);
    gl.readPixels(0, 0, this_.heightTex.width, this_.heightTex.height, gl.RGBA, gl.FLOAT, this_.heightData);
  });
};

Water.prototype.sampleHeight = function(x, z) {
  var t = Physics.worldToTex(x, z);
  var w = this.heightTex.width, h = this.heightTex.height;
  var fx = t.u * (w - 1), fz = t.v * (h - 1);
  var x0 = Math.floor(fx), z0 = Math.floor(fz);
  var x1 = Math.min(x0 + 1, w - 1), z1 = Math.min(z0 + 1, h - 1);
  var dx = fx - x0, dz = fz - z0;
  var heightData = this.heightData;
  function sample(gx, gz) {
    var i = (gz * w + gx) * 4;
    return { h: heightData[i], vy: heightData[i + 1] };
  }
  var c00 = sample(x0, z0);
  var c10 = sample(x1, z0);
  var c01 = sample(x0, z1);
  var c11 = sample(x1, z1);
  var h0 = c00.h * (1 - dx) + c10.h * dx;
  var h1 = c01.h * (1 - dx) + c11.h * dx;
  var vy0 = c00.vy * (1 - dx) + c10.vy * dx;
  var vy1 = c01.vy * (1 - dx) + c11.vy * dx;
  return { h: h0 * (1 - dz) + h1 * dz, vy: vy0 * (1 - dz) + vy1 * dz };
};
