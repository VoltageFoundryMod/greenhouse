-- blocks_grid.lua: the grid's blocks for diii's patch editor: single keys
-- and LEDs, and widgets made of keys (button, fader, steps, keys, ripples).
-- Loaded after blocks.lua, which it builds on (docs/VISUAL-EDITOR.md).

if not (B and B.type) then error("blocks_grid.lua: load blocks.lua first") end
B.grid_version = 8
-- on another device (achene), skip it: its blocks would only take memory
if not grid_led then
  print("blocks_grid: not a grid, skipped")
  return
end
local round, SCALES = B.round, B.SCALES

B.type("grid_key", {
  outputs = 1,
  init = function(node) node.listen("grid") end,
  event = function(node, _, x, y, z)
    if x == node.p.x and y == node.p.y then B.out(node, 1, z) end
  end,
})

-- ------------------------------------------------------------- grid

-- The grid blocks draw into one picture of levels (0-15), sent at most once
-- a tick with one grid_refresh, and a press goes to the block under it. A
-- grid widget has an area (x, y, w, h in keys) and
--   gdraw(node, put, w, h)       put(i, j, level), i and j from its top left
--   gpress(node, i, j, z, w, h)  a key in its area, pressed (1) or let go (0)
local gwidgets = {}   -- widget nodes, in the order made (later ones on top)
local graw = {}       -- grid led blocks: key index -> level
local grid_dirty = false

local function gsize()
  if grid_size_x then return grid_size_x(), grid_size_y() end
  return 16, 8
end

local function garea(node)
  local W, H = gsize()
  local x = clamp(math.floor(node.p.x or 1), 1, W)
  local y = clamp(math.floor(node.p.y or 1), 1, H)
  local w = clamp(math.floor(node.p.w or 1), 1, W - x + 1)
  local h = clamp(math.floor(node.p.h or 1), 1, H - y + 1)
  return x, y, w, h
end

function B.grid_draw()
  if not grid_dirty or not grid_led then return end
  grid_dirty = false
  grid_led_all(0)
  local W = gsize()
  for k, lvl in pairs(graw) do grid_led((k - 1) % W + 1, (k - 1) // W + 1, lvl) end
  for _, node in ipairs(gwidgets) do
    local x, y, w, h = garea(node)
    node.def.gdraw(node, function(i, j, lvl)
      if i >= 1 and i <= w and j >= 1 and j <= h then
        grid_led(x + i - 1, y + j - 1, clamp(round(lvl), 0, 15))
      end
    end, w, h)
  end
  grid_refresh()
end

local function gwidget(node)
  table.insert(gwidgets, node)
  node.listen("grid")
  grid_dirty = true
end

local function gforget(node)
  for i = #gwidgets, 1, -1 do
    if gwidgets[i] == node then table.remove(gwidgets, i) end
  end
  grid_dirty = true
end

local function gevent(node, _, gx, gy, z)
  local x, y, w, h = garea(node)
  local i, j = gx - x + 1, gy - y + 1
  if i >= 1 and i <= w and j >= 1 and j <= h then node.def.gpress(node, i, j, z, w, h) end
end

B.type("grid_led", {
  inputs = 1,
  input = function(node, _, v)
    local W = gsize()
    graw[((node.p.y or 1) - 1) * W + (node.p.x or 1)] = clamp(round(v * 15), 0, 15)
    grid_dirty = true
  end,
  stop = function(node)
    local W = gsize()
    graw[((node.p.y or 1) - 1) * W + (node.p.x or 1)] = nil
    grid_dirty = true
  end,
})

-- A button of one key or more. momentary: 1 pressed, 0 let go; toggle: each
-- press flips it, 1 or 0; trigger: 1 on each press. Lit while held or on;
-- its input lights it (and sets a toggle) without sending.
local BUTTON_OFF, BUTTON_ON = 3, 15

B.type("gbutton", {
  inputs = 1, outputs = 1,
  init = function(node)
    node.on = node.old and node.old.on or false
    node.down = 0
    gwidget(node)
  end,
  start = function(node)
    if node.p.mode == "toggle" then B.out(node, 1, node.on and 1 or 0) end
  end,
  stop = gforget,
  event = gevent,
  save = function(node) if node.p.mode == "toggle" then return {on = node.on} end end,
  load = function(node, st) node.on = st.on == true grid_dirty = true end,
  input = function(node, _, v)
    node.on = v ~= 0
    grid_dirty = true
  end,
  gpress = function(node, _, _, z)
    local was = node.down
    node.down = math.max(0, was + (z == 1 and 1 or -1))
    local mode = node.p.mode or "momentary"
    if mode == "toggle" then
      if was == 0 and node.down > 0 then
        node.on = not node.on
        B.out(node, 1, node.on and 1 or 0)
      end
    elseif mode == "trigger" then
      if was == 0 and node.down > 0 then B.out(node, 1, 1) end
    elseif (was == 0) ~= (node.down == 0) then
      B.out(node, 1, node.down > 0 and 1 or 0)
    end
    grid_dirty = true
  end,
  gdraw = function(node, put, w, h)
    local lvl = (node.down > 0 or node.on) and BUTTON_ON or BUTTON_OFF
    for j = 1, h do
      for i = 1, w do put(i, j, lvl) end
    end
  end,
})

-- A fader: a row (or column) of keys from lo to hi, vertical when taller than
-- wide (or as set), bottom or left being lo; a wide one moves as one. A press
-- sends its value; the input moves it without sending.
local function gfader_shape(node, w, h)
  local o = node.p.orient or "auto"
  local vert = o == "vertical" or (o == "auto" and h > w)
  return vert, vert and h or w
end

local function gfader_range(node)
  return node.p.lo or 0, node.p.hi or 127
end

B.type("gfader", {
  inputs = 1, outputs = 1,
  init = function(node)
    local lo = gfader_range(node)
    node.v = node.old and node.old.v or node.p.start or lo
    gwidget(node)
  end,
  start = function(node) B.out(node, 1, node.v) end,
  stop = gforget,
  event = gevent,
  save = function(node) return {v = node.v} end,
  load = function(node, st) if type(st.v) == "number" then node.v = st.v grid_dirty = true end end,
  input = function(node, _, v)
    node.v = v
    grid_dirty = true
  end,
  gpress = function(node, i, j, z, w, h)
    if z ~= 1 then return end
    local vert, n = gfader_shape(node, w, h)
    local k = vert and (h - j + 1) or i
    local lo, hi = gfader_range(node)
    local v = n > 1 and lo + (hi - lo) * (k - 1) / (n - 1) or hi
    if lo == math.floor(lo) and hi == math.floor(hi) then v = round(v) end
    node.v = v
    B.out(node, 1, v)
    grid_dirty = true
  end,
  gdraw = function(node, put, w, h)
    local vert, n = gfader_shape(node, w, h)
    local lo, hi = gfader_range(node)
    local pos = n
    if hi ~= lo then pos = clamp(round((node.v - lo) / (hi - lo) * (n - 1)) + 1, 1, n) end
    local dot = node.p.style == "dot"
    for k = 1, n do
      local lvl = 2
      if k == pos then lvl = 15
      elseif not dot and k < pos then lvl = 8 end
      if vert then
        for i = 1, w do put(i, h - k + 1, lvl) end
      else
        for j = 1, h do put(k, j, lvl) end
      end
    end
  end,
})

-- ------------------------------------------------------------- grid: steps, keys, ripples

-- the d-th note of a scale from base (d from 0; below 0 goes down)
local function degree_note(base, scale, d)
  local st = SCALES[scale or "major"] or SCALES.major
  local n = #st
  return base + 12 * (d // n) + st[d % n + 1]
end

-- notes a grid widget plays itself, on its own channel, several at once
local function gnote_on(node, note, vel)
  if node.p.send == "outputs only" then return end
  midi_note_on(note, clamp(round(vel), 1, 127), node.p.ch or 1)
end

local function gnote_off(node, note)
  if node.p.send == "outputs only" then return end
  midi_note_off(note, 0, node.p.ch or 1)
end

-- A step grid: each column a step, each row a note of the scale from note
-- (the bottom row lowest); one key high, a row of steps that are on or off.
-- A press puts its step on that row, or turns it off when it is there.
-- Steps past the width go on to pages: the page playing shows, unless
-- input 2 picked one (as the achene steps block's page input: positive
-- next, negative previous, through auto). Input 1 is the step number, or
-- with "input 1 is" set to beat, a beat; input 3 sets the length (1-64);
-- input 4 transposes, in semitones. Outputs: the gate, the note (sent
-- before the gate), the step number.
local function gs_count(node) return clamp(math.floor(node.len or node.p.steps or 16), 1, 64) end

local function gs_note(node, s)
  return clamp(degree_note(node.p.note or 48, node.p.scale, node.row[s] or 0) + (node.transpose or 0), 0, 127)
end

B.type("gsteps", {
  inputs = 4, outputs = 3,
  init = function(node)
    local old = node.old
    node.row = old and old.row or {}   -- step -> its row from the bottom (0-based); nil: off
    node.page = old and old.page or 0
    node.pin = old and old.pin or nil
    node.len = old and old.len or nil
    node.pos = old and old.pos or nil
    node.transpose = old and old.transpose or 0
    gwidget(node)
  end,
  stop = function(node)
    if node.gate then B.out(node, 1, 0) end
    gforget(node)
  end,
  event = gevent,
  -- the rows (-1 off), the length, the page
  save = function(node)
    local last = 0
    for st = 1, 64 do if node.row[st] then last = st end end
    local rows = {}
    for st = 1, last do rows[st] = node.row[st] or -1 end
    return {rows = rows, len = node.len, pin = node.pin}
  end,
  load = function(node, st)
    if type(st.rows) == "table" then
      node.row = {}
      for k, r in ipairs(st.rows) do if type(r) == "number" and r >= 0 then node.row[k] = r end end
    end
    if type(st.len) == "number" then node.len = clamp(math.floor(st.len), 1, 64) end
    if type(st.pin) == "number" then node.pin, node.page = st.pin, st.pin end
    grid_dirty = true
  end,
  input = function(node, i, v)
    local _, _, w = garea(node)
    if i == 3 then
      node.len = clamp(round(v), 1, 64)
      local pages = (node.len + w - 1) // w
      if node.pin and node.pin >= pages then node.pin = nil end
      if node.page >= pages then node.page = pages - 1 end
      grid_dirty = true
      return
    end
    if i == 4 then
      node.transpose = round(v)
      return
    end
    if i == 2 then
      if v == 0 then return end
      local pages = (gs_count(node) + w - 1) // w
      local at = (node.pin or -1) + (v > 0 and 1 or -1)
      if at >= pages then at = -1 elseif at < -1 then at = pages - 1 end
      node.pin = at >= 0 and at or nil
      node.page = node.pin or (node.pos and (node.pos - 1) // w) or 0
      grid_dirty = true
      return
    end
    v = round(v)
    if v == 0 then return end
    local n = gs_count(node)
    if node.p.advance == "beat" then
      node.pos = (node.pos or 0) % n + 1
    else
      node.pos = (v - 1) % n + 1
    end
    if not node.pin then node.page = (node.pos - 1) // w end
    if node.gate then
      node.gate = false
      B.out(node, 1, 0)
    end
    B.out(node, 3, node.pos)
    B.out(node, 2, gs_note(node, node.pos))
    if node.row[node.pos] then
      node.gate = true
      B.out(node, 1, 1)
    end
    grid_dirty = true
  end,
  gpress = function(node, i, j, z, w, h)
    if z ~= 1 then return end
    local st = node.page * w + i
    if st > gs_count(node) then return end
    local r = h - j
    if node.row[st] == r then node.row[st] = nil else node.row[st] = r end
    grid_dirty = true
  end,
  -- a step's note bright (brightest playing), the playing column dim, and
  -- a faint bottom row as far as the steps go
  gdraw = function(node, put, w, h)
    local n = gs_count(node)
    for i = 1, w do
      local st = node.page * w + i
      if st <= n then
        local playing = st == node.pos
        for j = 1, h do
          local lvl = playing and 3 or (j == h and 1 or 0)
          if node.row[st] == h - j then lvl = playing and 15 or 9 end
          put(i, j, lvl)
        end
      end
    end
  end,
})

-- An isomorphic keyboard: notes rise by a semitone to the right and by row
-- (5, a fourth, as on Push and Launchpad) going up, from note at the bottom
-- left. The root's keys are lit brighter, the scale's dimmer; a held note
-- lights every key that plays it. It plays MIDI itself, several notes at
-- once (send: midi), and sends the last note and a gate for wiring (the
-- note first; the gate is 1 while any key is held). Input 1 transposes, in
-- semitones (octaves from a fader, say).
local function gk_note(node, i, j, h)
  return (node.p.note or 48) + (i - 1) + (h - j) * (node.p.row or 5) + (node.transpose or 0)
end

B.type("gkeys", {
  inputs = 1, outputs = 2,
  init = function(node)
    node.held = {}
    node.transpose = node.old and node.old.transpose or 0
    gwidget(node)
  end,
  stop = function(node)
    for _, note in pairs(node.held) do gnote_off(node, note) end
    if next(node.held) then B.out(node, 1, 0) end
    node.held = {}
    gforget(node)
  end,
  event = gevent,
  input = function(node, _, v)
    node.transpose = round(v)
    grid_dirty = true
  end,
  gpress = function(node, i, j, z, _, h)
    local k = j * 100 + i
    if z == 1 then
      local note = clamp(gk_note(node, i, j, h), 0, 127)
      node.held[k] = note
      gnote_on(node, note, node.p.vel or 100)
      B.out(node, 2, note)
      B.out(node, 1, 1)
    else
      local note = node.held[k]
      if not note then return end
      node.held[k] = nil
      gnote_off(node, note)
      if next(node.held) == nil then B.out(node, 1, 0) end
    end
    grid_dirty = true
  end,
  gdraw = function(node, put, w, h)
    local sounding = {}
    for _, note in pairs(node.held) do sounding[note] = true end
    local root = ((node.p.note or 48) + (node.transpose or 0)) % 12
    local in_scale = {}
    for _, d in ipairs(SCALES[node.p.scale or "major"] or SCALES.major) do in_scale[d] = true end
    for j = 1, h do
      for i = 1, w do
        local note = gk_note(node, i, j, h)
        local pc = (note - root) % 12
        local lvl = 0
        if sounding[note] then lvl = 15
        elseif pc == 0 then lvl = 8
        elseif in_scale[pc] then lvl = 3 end
        put(i, j, lvl)
      end
    end
  end,
})

-- Ripples: a press drops a stone. It plays the key's note (a scale from
-- note: a step to the right, a step going up) and a ring spreads from the
-- key at speed keys a second, fading as it goes. Each key it grows plays
-- again, step scale steps higher and quieter, for echoes times. Input 1
-- drops one on a random key (anything but 0: a metro makes rain); input 2
-- sets the speed. It plays MIDI itself, each note len ms long, and sends
-- each note and a gate for wiring. Notes are folded into the four octaves
-- from note, so the echoes of a high key don't climb out of hearing.
local RIPPLES_MAX = 6 -- rings at once; a new one takes the oldest's place

local function ripple_play(node, ring, k)
  local base = node.p.note or 48
  local note = degree_note(base, node.p.scale, ring.deg + k * (node.p.step or 2))
  while note >= base + 48 do note = note - 12 end
  while note < base do note = note + 12 end
  note = clamp(note, 0, 127)
  local echoes = node.p.echoes or 4
  gnote_on(node, note, (node.p.vel or 100) * (1 - k / (echoes + 1)))
  table.insert(node.offs, {note, B.ticks + math.max(1, round((node.p.len or 150) / 20))})
  B.out(node, 2, note)
  B.out(node, 1, 1)
end

B.type("gripples", {
  inputs = 2, outputs = 2,
  init = function(node)
    node.rings, node.offs = {}, {}
    gwidget(node)
  end,
  stop = function(node)
    for _, o in ipairs(node.offs) do gnote_off(node, o[1]) end
    node.offs, node.rings = {}, {}
    gforget(node)
  end,
  event = gevent,
  input = function(node, i, v)
    if i == 2 then
      if v > 0 then node.speed = v end
      return
    end
    if v == 0 then return end
    local _, _, w, h = garea(node)
    node.def.gpress(node, math.random(1, w), math.random(1, h), 1, w, h)
  end,
  gpress = function(node, i, j, z, _, h)
    if z ~= 1 then return end
    local ring = {x = i, y = j, r = 0, deg = (i - 1) + (h - j), played = 0}
    table.insert(node.rings, ring)
    if #node.rings > RIPPLES_MAX then table.remove(node.rings, 1) end
    ripple_play(node, ring, 0)
    grid_dirty = true
  end,
  tick = function(node, dt)
    local _, _, w, h = garea(node)
    local far = math.sqrt(w * w + h * h) + 1
    local speed = node.speed or node.p.speed or 6
    local echoes = node.p.echoes or 4
    for k = #node.rings, 1, -1 do
      local ring = node.rings[k]
      ring.r = ring.r + speed * dt
      local step = math.floor(ring.r)
      if step > ring.played then
        ring.played = step
        if step <= echoes then ripple_play(node, ring, step) end
      end
      if ring.r > far then table.remove(node.rings, k) end
    end
    -- drawn 25 times a second while rings spread
    if #node.rings > 0 and B.ticks % 2 == 0 then grid_dirty = true end
    for k = #node.offs, 1, -1 do
      local o = node.offs[k]
      if B.ticks >= o[2] then
        gnote_off(node, o[1])
        table.remove(node.offs, k)
        if #node.offs == 0 then B.out(node, 1, 0) end
      end
    end
    if #node.rings == 0 and node.lit then
      node.lit = false
      grid_dirty = true
    end
  end,
  -- each ring a band about a key wide, dimmer the further it has gone
  gdraw = function(node, put, w, h)
    local far = math.sqrt(w * w + h * h) + 1
    node.lit = #node.rings > 0
    for j = 1, h do
      for i = 1, w do
        local lvl = 0
        for _, ring in ipairs(node.rings) do
          local dx, dy = i - ring.x, j - ring.y
          local d2 = dx * dx + dy * dy
          local lo, hi = math.max(ring.r - 1, 0), ring.r + 1
          if d2 < hi * hi and d2 > lo * lo - 0.001 then
            local l = (1 - math.abs(math.sqrt(d2) - ring.r)) * 15 * (1 - ring.r / far)
            if l > lvl then lvl = l end
          end
        end
        put(i, j, lvl)
      end
    end
  end,
})

print("blocks_grid " .. B.grid_version)
