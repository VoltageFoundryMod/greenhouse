-- blocks.lua: the runtime for diii's patch editor (docs/VISUAL-EDITOR.md)
--
-- A patch is nodes joined by wires; messages are numbers pushed along the
-- wires when something happens. diii uploads this file and builds patches
-- with B.node / B.wire (live) or B.patch{...} (a saved patch file).

B = B or {}
B.version = 3
B.types = {}

local nodes = {}      -- id -> node
local listeners = {}  -- event name -> list of nodes
local tickers = {}    -- nodes with a tick
local pending = {}    -- node -> {value, send}: held by the send limit
local tick_metro = nil
local running = false
local ticks = 0
local TICK = 1 / 50

-- ------------------------------------------------------------- core

-- A block type: def.inputs, def.outputs, and any of
--   init(node)          when made: set up state, node.listen(event)
--   start(node)         once the patch is wired (and when replaced while
--                       running): its first value, e.g. a value block's start
--   input(node, i, v)   a message on input i
--   event(node, name, ...)  a device event it listens to
--   tick(node, dt)      50 times a second
--   stop(node)          when removed: let go of notes, LEDs
function B.type(name, def)
  def.inputs = def.inputs or 0
  def.outputs = def.outputs or 0
  B.types[name] = def
end

function B.out(node, i, v)
  local wires = node.outs[i]
  if not wires then return end
  for _, w in ipairs(wires) do
    local to = nodes[w[1]]
    if to and to.def.input then to.def.input(to, w[2], v) end
  end
end

-- The send limit for outputs: at most one send every `every` ticks (1 =
-- 50 a second). A value that comes sooner is held and the latest one goes
-- out on a later tick, so a fast LFO can't flood MIDI and a knob still
-- answers at once.
function B.limit(node, v, send, every)
  every = every or 1
  if node.sent_at and ticks - node.sent_at < every then
    pending[node] = {v, send, every}
    return
  end
  pending[node] = nil
  node.sent_at = ticks
  send(node, v)
end

local function flush()
  for node, p in pairs(pending) do
    if ticks - (node.sent_at or 0) >= p[3] then
      pending[node] = nil
      node.sent_at = ticks
      p[2](node, p[1])
    end
  end
end

local function listen(node, event)
  listeners[event] = listeners[event] or {}
  table.insert(listeners[event], node)
end

local function forget(node)
  for _, list in pairs(listeners) do
    for i = #list, 1, -1 do
      if list[i] == node then table.remove(list, i) end
    end
  end
  for i = #tickers, 1, -1 do
    if tickers[i] == node then table.remove(tickers, i) end
  end
  pending[node] = nil
end

local function remove(id)
  local node = nodes[id]
  if not node then return end
  if node.def.stop then node.def.stop(node) end
  forget(node)
  nodes[id] = nil
end

function B.node(id, typename, params)
  local def = B.types[typename]
  if not def then
    print("blocks: no block type " .. tostring(typename))
    return
  end
  local old = nodes[id]
  remove(id)
  local node = {id = id, type = typename, def = def, p = params or {}, outs = old and old.outs or {}}
  nodes[id] = node
  node.listen = function(event) listen(node, event) end
  if def.init then def.init(node) end
  if def.tick then table.insert(tickers, node) end
  if running and def.start then def.start(node) end
  return node
end

function B.remove(id) remove(id) end

function B.wire(from, out, to, inp)
  local node = nodes[from]
  if not node then return end
  node.outs[out] = node.outs[out] or {}
  for _, w in ipairs(node.outs[out]) do
    if w[1] == to and w[2] == inp then return end
  end
  table.insert(node.outs[out], {to, inp})
end

function B.unwire(from, out, to, inp)
  local node = nodes[from]
  local wires = node and node.outs[out]
  if not wires then return end
  for i = #wires, 1, -1 do
    if wires[i][1] == to and wires[i][2] == inp then table.remove(wires, i) end
  end
end

function B.set(id, key, value)
  local node = nodes[id]
  if not node then return end
  node.p[key] = value
  if node.def.param then node.def.param(node, key, value) end
end

local function dispatch(event, ...)
  local list = listeners[event]
  if not list then return end
  for _, node in ipairs(list) do node.def.event(node, event, ...) end
end

function B.start()
  event_enc = function(n, d) dispatch("enc", n, d) end
  event_enc_key = function(n, z) dispatch("enc_key", n, z) end
  event_key = function(n, z) dispatch("key", n, z) end
  event_grid = function(x, y, z) dispatch("grid", x, y, z) end
  event_midi = function(a, b, c) dispatch("midi", a, b, c) end
  if not tick_metro then
    tick_metro = metro.init(function()
      ticks = ticks + 1
      for _, node in ipairs(tickers) do node.def.tick(node, TICK) end
      flush()
      if B.redraw then B.redraw() end
    end, TICK)
  end
  if tick_metro then tick_metro:start() end
  running = true
  for _, node in pairs(nodes) do
    if node.def.start then node.def.start(node) end
  end
end

function B.clear()
  for id in pairs(nodes) do remove(id) end
  listeners, tickers, pending = {}, {}, {}
  running = false
  if tick_metro then tick_metro:stop() end
  B.screen_clear()
  -- the tick that redraws is stopped: blank the screen now
  if screen_clear then
    screen_clear()
    screen_refresh()
  end
end

function B.patch(p)
  B.clear()
  for _, n in ipairs(p.nodes or {}) do B.node(n[1], n[2], n[3]) end
  for _, w in ipairs(p.wires or {}) do B.wire(w[1], w[2], w[3], w[4]) end
  B.start()
end

-- ------------------------------------------------------------- screen

-- display nodes draw into eight slots (two columns of four) on the OLED;
-- B.redraw runs on the tick and redraws only when something changed
local slots = {}
local screen_dirty = false

function B.screen_clear()
  slots = {}
  screen_dirty = true
end

function B.redraw()
  if not screen_dirty or not screen_clear then return end
  screen_dirty = false
  screen_clear()
  for i = 1, 8 do
    local s = slots[i]
    if s then
      local x = ((i - 1) // 4) * 64
      local y = ((i - 1) % 4) * 16
      screen_text(x, y, s.label, 1)
      screen_rect(x, y + 9, 60, 5, 1, false)
      local w = math.floor(58 * clamp(s.value, 0, 1) + 0.5)
      if w > 0 then screen_rect(x + 1, y + 10, w, 3, 1, true) end
    end
  end
  screen_refresh()
end

local function slot_set(slot, label, value)
  slots[slot] = {label = label, value = value}
  screen_dirty = true
end

-- ------------------------------------------------------------- helpers

local function round(v) return math.floor(v + 0.5) end

-- a gate on a clock: 1 at each beat, 0 halfway to the next
local function gate(node, phase)
  local high = phase < 0.5
  if high ~= node.high then
    node.high = high
    B.out(node, 1, high and 1 or 0)
  end
end

local MIDI_CC, MIDI_ON, MIDI_OFF = 0xb0, 0x90, 0x80

local function on_channel(node, status, kind)
  return status & 0xf0 == kind and (status & 0x0f) + 1 == (node.p.ch or 1)
end

-- ------------------------------------------------------------- sources

B.type("encoder", {
  outputs = 1,
  init = function(node) node.listen("enc") end,
  event = function(node, _, n, d)
    if n == node.p.n then B.out(node, 1, d) end
  end,
})

B.type("enc_push", {
  outputs = 1,
  init = function(node) node.listen("enc_key") end,
  event = function(node, _, n, z)
    if n == node.p.n then B.out(node, 1, z) end
  end,
})

B.type("key", {
  outputs = 1,
  init = function(node) node.listen("key") end,
  event = function(node, _, n, z)
    if n == node.p.n then B.out(node, 1, z) end
  end,
})

B.type("grid_key", {
  outputs = 1,
  init = function(node) node.listen("grid") end,
  event = function(node, _, x, y, z)
    if x == node.p.x and y == node.p.y then B.out(node, 1, z) end
  end,
})

B.type("lfo", {
  outputs = 1,
  init = function(node) node.phase = 0 end,
  tick = function(node, dt)
    node.phase = (node.phase + dt * (node.p.rate or 1)) % 1
    local ph, shape, v = node.phase, node.p.shape or "sine", 0
    if shape == "sine" then v = 0.5 - 0.5 * math.cos(ph * 2 * math.pi)
    elseif shape == "triangle" then v = ph < 0.5 and ph * 2 or 2 - ph * 2
    elseif shape == "saw" then v = ph
    else v = ph < 0.5 and 1 or 0 end
    B.out(node, 1, v)
  end,
})

-- 1 at each beat, 0 halfway; input 1 turns it off (0) and on (not 0)
B.type("metro", {
  inputs = 1, outputs = 1,
  init = function(node) node.t, node.on = 0, true end,
  input = function(node, _, v)
    node.on = v ~= 0
    if not node.on and node.high then
      node.high = false
      B.out(node, 1, 0)
    end
  end,
  tick = function(node, dt)
    if not node.on then return end
    local period = math.max(node.p.ms or 500, 20) / 1000
    node.t = (node.t + dt) % period
    gate(node, node.t / period)
  end,
})

-- MIDI clock in: a gate every `div` clocks (24 = a quarter note); output 2
-- is 1 on start and 0 on stop
B.type("clock", {
  outputs = 2,
  init = function(node)
    node.listen("midi")
    node.count = 0
  end,
  event = function(node, _, status)
    local div = math.max(node.p.div or 24, 1)
    if status == 0xf8 then
      gate(node, (node.count % div) / div)
      node.count = node.count + 1
    elseif status == 0xfa then
      node.count = 0
      B.out(node, 2, 1)
    elseif status == 0xfc then
      B.out(node, 2, 0)
    end
  end,
})

B.type("midi_in_cc", {
  outputs = 1,
  init = function(node) node.listen("midi") end,
  event = function(node, _, status, cc, value)
    if on_channel(node, status, MIDI_CC) and cc == node.p.cc then B.out(node, 1, value) end
  end,
})

-- output 1: the note number when one starts; output 2: 1 on, 0 off
B.type("midi_in_note", {
  outputs = 2,
  init = function(node) node.listen("midi") end,
  event = function(node, _, status, note, vel)
    if on_channel(node, status, MIDI_ON) and vel > 0 then
      B.out(node, 1, note)
      B.out(node, 2, 1)
    elseif on_channel(node, status, MIDI_OFF) or on_channel(node, status, MIDI_ON) then
      B.out(node, 2, 0)
    end
  end,
})

-- ------------------------------------------------------------- processors

B.type("accum", {
  inputs = 1, outputs = 1,
  init = function(node) node.v = node.p.start or 64 end,
  start = function(node) B.out(node, 1, node.v) end,
  input = function(node, _, d)
    node.v = clamp(node.v + d, node.p.lo or 0, node.p.hi or 127)
    B.out(node, 1, node.v)
  end,
})

B.type("scale", {
  inputs = 1, outputs = 1,
  input = function(node, _, v)
    local p = node.p
    B.out(node, 1, linlin(v, p.in_lo or 0, p.in_hi or 1, p.out_lo or 0, p.out_hi or 127))
  end,
})

B.type("toggle", {
  inputs = 1, outputs = 1,
  init = function(node) node.on = false end,
  input = function(node, _, v)
    if v ~= 0 then
      node.on = not node.on
      B.out(node, 1, node.on and 1 or 0)
    end
  end,
})

-- input 1 (not 0): the next step, wrapping from hi to lo; input 2: back to
-- lo. The first step after the start or a reset is lo itself, so a
-- sequencer plays step 1 first.
B.type("counter", {
  inputs = 2, outputs = 1,
  init = function(node)
    node.v = node.p.lo or 1
    node.fresh = true
  end,
  start = function(node) B.out(node, 1, node.v) end,
  input = function(node, i, v)
    if v == 0 then return end
    local lo, hi = node.p.lo or 1, node.p.hi or 8
    if i == 2 then
      node.v, node.fresh = lo, true
    elseif node.fresh then
      node.fresh = false
    else
      node.v = node.v + (node.p.step or 1)
      if node.v > hi then node.v = lo elseif node.v < lo then node.v = hi end
    end
    B.out(node, 1, node.v)
  end,
})

-- a whole number from lo to hi each time the input isn't 0
B.type("random", {
  inputs = 1, outputs = 1,
  input = function(node, _, v)
    if v == 0 then return end
    local lo, hi = round(node.p.lo or 0), round(node.p.hi or 127)
    if hi < lo then lo, hi = hi, lo end
    B.out(node, 1, math.random(lo, hi))
  end,
})

local SCALES = {
  chromatic = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11},
  major = {0, 2, 4, 5, 7, 9, 11},
  minor = {0, 2, 3, 5, 7, 8, 10},
  dorian = {0, 2, 3, 5, 7, 9, 10},
  pentatonic = {0, 2, 4, 7, 9},
  ["minor pent."] = {0, 3, 5, 7, 10},
}

-- the nearest note of the scale (ties go down)
B.type("quantize", {
  inputs = 1, outputs = 1,
  input = function(node, _, v)
    local steps = SCALES[node.p.scale or "major"] or SCALES.major
    local root, n = (node.p.root or 0) % 12, round(v)
    local best, dist = n, 99
    for octave = -1, 1 do
      for _, s in ipairs(steps) do
        local c = (n - (n - root) % 12) + s + octave * 12
        local d = math.abs(c - n)
        if d < dist or (d == dist and c < best) then best, dist = c, d end
      end
    end
    B.out(node, 1, best)
  end,
})

-- glides to each new value over `time` seconds (0: at once)
B.type("slew", {
  inputs = 1, outputs = 1,
  input = function(node, _, v)
    node.target = v
    if node.v == nil or (node.p.time or 0) <= 0 then
      node.v = v
      B.out(node, 1, v)
    end
  end,
  tick = function(node, dt)
    if node.v == nil or node.target == nil or node.v == node.target then return end
    -- exponential: within ~2% of the target after `time`
    local time = node.p.time or 0
    local k = time > 0 and 1 - math.exp(-4 * dt / time) or 1
    local d = node.target - node.v
    if math.abs(d) < 0.01 then node.v = node.target
    else node.v = node.v + d * k end
    B.out(node, 1, node.v)
  end,
})

-- passes input 1 while input 2 is open (not 0); starts open
B.type("gate", {
  inputs = 2, outputs = 1,
  init = function(node) node.open = true end,
  input = function(node, i, v)
    if i == 2 then node.open = v ~= 0
    elseif node.open then B.out(node, 1, v) end
  end,
})

-- custom code: the code runs for each message with node, i (the input),
-- v (the value), out(n, value) to send, and s, a table kept between calls
B.type("lua", {
  inputs = 2, outputs = 2,
  init = function(node)
    node.s = {}
    local code = "local node, i, v, out, s = ...\n" .. (node.p.code or "")
    local fn, err = load(code, "lua block " .. node.id)
    if not fn then print("lua block " .. node.id .. ": " .. err) end
    node.fn = fn
    node.out = function(n, value) B.out(node, n, value) end
  end,
  input = function(node, i, v)
    if not node.fn then return end
    local ok, err = pcall(node.fn, node, i, v, node.out, node.s)
    if not ok and not node.failed then
      node.failed = true
      print("lua block " .. node.id .. ": " .. tostring(err))
    end
  end,
})

-- ------------------------------------------------------------- outputs

local function send_cc(node, v)
  local value = clamp(round(v), 0, 127)
  if value == node.last then return end
  node.last = value
  midi_cc(node.p.cc or 1, value, node.p.ch or 1)
end

B.type("midi_cc", {
  inputs = 1,
  input = function(node, _, v) B.limit(node, v, send_cc) end,
})

-- input 1 (not 0): note on, 0: note off; input 2 sets the note number
B.type("midi_note", {
  inputs = 2,
  input = function(node, i, v)
    if i == 2 then
      node.next_note = clamp(round(v), 0, 127)
      return
    end
    local ch = node.p.ch or 1
    if v ~= 0 and not node.on then
      node.on = node.next_note or node.p.note or 60
      midi_note_on(node.on, node.p.vel or 100, ch)
    elseif v == 0 and node.on then
      midi_note_off(node.on, 0, ch)
      node.on = nil
    end
  end,
  stop = function(node)
    if node.on then midi_note_off(node.on, 0, node.p.ch or 1) end
  end,
})

local COLOURS = {
  white = {255, 255, 255}, red = {255, 0, 0}, amber = {255, 120, 0},
  green = {0, 255, 60}, cyan = {0, 200, 255}, blue = {0, 40, 255}, pink = {255, 0, 120},
}

local function send_key_led(node, v)
  local c = COLOURS[node.p.colour or "white"] or COLOURS.white
  local b = clamp(v, 0, 1)
  key_led(node.p.n or 1, math.floor(c[1] * b), math.floor(c[2] * b), math.floor(c[3] * b))
  key_led_refresh()
end

B.type("key_led", {
  inputs = 1,
  input = function(node, _, v)
    if key_led then B.limit(node, v, send_key_led) end
  end,
  stop = function(node)
    if key_led then key_led(node.p.n or 1, 0, 0, 0) key_led_refresh() end
  end,
})

local function send_grid_led(node, v)
  grid_led(node.p.x or 1, node.p.y or 1, clamp(round(v * 15), 0, 15))
  grid_refresh()
end

B.type("grid_led", {
  inputs = 1,
  input = function(node, _, v)
    if grid_led then B.limit(node, v, send_grid_led) end
  end,
  stop = function(node)
    if grid_led then grid_led(node.p.x or 1, node.p.y or 1, 0) grid_refresh() end
  end,
})

B.type("display", {
  inputs = 1,
  init = function(node) slot_set(node.p.slot or 1, node.p.label or "", 0) end,
  stop = function(node)
    slots[node.p.slot or 1] = nil
    screen_dirty = true
  end,
  input = function(node, _, v)
    local lo, hi = node.p.lo or 0, node.p.hi or 127
    slot_set(node.p.slot or 1, node.p.label or "", (v - lo) / (hi - lo))
  end,
})

-- prints to the REPL (diii's console), at most 10 a second
local function send_print(node, v)
  local text = math.type(v) == "float" and string.format("%.3f", v) or tostring(v)
  print((node.p.label or "") .. " " .. text)
end

B.type("print", {
  inputs = 1,
  input = function(node, _, v) B.limit(node, v, send_print, 5) end,
})

print("blocks " .. B.version)
