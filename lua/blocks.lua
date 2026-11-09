-- blocks.lua: the runtime for diii's patch editor (docs/VISUAL-EDITOR.md)
--
-- A patch is nodes joined by wires; messages are numbers pushed along the
-- wires when something happens. diii uploads this file and builds patches
-- with B.node / B.wire (live) or B.patch{...} (a saved patch file).

-- Loaded again (diii sends a newer copy): stop the copy that's running
-- first, or its clock and patch would carry on beside this one.
if B and B.clear then B.clear() end
B = B or {}
B.version = 7
B.types = {}

local nodes = {}      -- id -> node
local vars = {}       -- name -> value, for set var / get var
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
  -- replaced (a field edited): init may keep what the old one held
  if old and old.type == typename then node.old = old end
  if def.init then def.init(node) end
  node.old = nil
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
    -- the clock of a copy loaded before is reused (iii has 12 metros)
    tick_metro = B.tick_metro or metro.init(function() end, TICK)
    B.tick_metro = tick_metro
    if tick_metro then
      tick_metro.event = function()
        ticks = ticks + 1
        for _, node in ipairs(tickers) do node.def.tick(node, TICK) end
        flush()
        if B.redraw then B.redraw() end
        if B.grid_draw then B.grid_draw() end
      end
      tick_metro.time = TICK
    end
  end
  if tick_metro then tick_metro:start() end
  running = true
  for _, node in pairs(nodes) do
    if node.def.start then node.def.start(node) end
  end
end

function B.clear()
  for id in pairs(nodes) do remove(id) end
  listeners, tickers, pending, vars = {}, {}, {}, {}
  running = false
  if tick_metro then tick_metro:stop() end
  B.screen_clear()
  -- the tick that draws is stopped: blank the grid and the screen now
  if B.grid_draw then B.grid_draw() end
  if screen_clear then
    screen_clear()
    screen_refresh()
  end
end

-- ------------------------------------------------------------- state

-- What a block remembers (a pattern, a value, a toggle's side): def.save
-- returns it as a table, def.load puts it back. diii asks for it (B.state)
-- before stopping or saving, and sends it back with the patch, so a patch
-- starts again where it was.
local function json(v)
  local t = type(v)
  if t == "number" then
    if v == math.floor(v) and math.abs(v) < 2^53 then return string.format("%d", v) end
    return string.format("%.6g", v)
  elseif t == "boolean" then
    return v and "true" or "false"
  elseif t == "string" then
    return '"' .. (v:gsub('[%c"\\]', "")) .. '"'
  elseif t == "table" then
    local parts = {}
    if #v > 0 then
      for i = 1, #v do parts[i] = json(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, x in pairs(v) do parts[#parts + 1] = '"' .. tostring(k) .. '":' .. json(x) end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

function B.state()
  for id, node in pairs(nodes) do
    if node.def.save then
      local st = node.def.save(node)
      if st then print("__webdiii_state\t" .. id .. "\t" .. json(st)) end
    end
  end
end

function B.load(id, st)
  local node = nodes[id]
  if node and node.def.load and type(st) == "table" then node.def.load(node, st) end
end

-- how big the running patch is: its blocks and Lua's memory in KB
function B.stats()
  local n = 0
  for _ in pairs(nodes) do n = n + 1 end
  print("__webdiii_stats\t" .. n .. "\t" .. math.floor(collectgarbage("count")))
end

function B.patch(p)
  B.clear()
  for _, n in ipairs(p.nodes or {}) do
    B.node(n[1], n[2], n[3])
    if n[4] then B.load(n[1], n[4]) end
  end
  for _, w in ipairs(p.wires or {}) do B.wire(w[1], w[2], w[3], w[4]) end
  B.start()
end

-- ------------------------------------------------------------- screen

-- display nodes draw into eight slots (two columns of four) on the OLED;
-- B.redraw runs on the tick and redraws only when something changed
local slots = {}
local widgets = {}   -- the screen blocks below, drawn in order
local screen_dirty = false

function B.screen_clear()
  slots, widgets = {}, {}
  screen_dirty = true
end

-- at most 25 times a second (the screen sends a frame in the background)
function B.redraw()
  if not screen_dirty or not screen_clear or ticks % 2 == 1 then return end
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
  for _, node in ipairs(widgets) do node.def.paint(node) end
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
-- Input 2 sets the tempo in BPM (then ms is unused): `per` beats come for
-- each quarter note (2 for eighths, 4 for sixteenths). It steps on the 50 Hz
-- tick, so its timing is rounded to 20 ms.
B.type("metro", {
  inputs = 2, outputs = 1,
  init = function(node)
    node.t, node.on = 0, true
    node.bpm = node.old and node.old.bpm or nil
  end,
  input = function(node, i, v)
    if i == 2 then
      if v > 0 then node.bpm = v end
      return
    end
    node.on = v ~= 0
    if not node.on and node.high then
      node.high = false
      B.out(node, 1, 0)
    end
  end,
  tick = function(node, dt)
    if not node.on then return end
    local period = math.max(node.p.ms or 500, 20) / 1000
    if node.bpm then period = math.max(60 / (node.bpm * (tonumber(node.p.per) or 1)), 0.02) end
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
  save = function(node) return {v = node.v} end,
  load = function(node, st) if type(st.v) == "number" then node.v = st.v end end,
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

-- sends its state at the start too (0), so a metro it switches waits for it
B.type("toggle", {
  inputs = 1, outputs = 1,
  init = function(node) node.on = node.old and node.old.on or false end,
  start = function(node) B.out(node, 1, node.on and 1 or 0) end,
  save = function(node) return {on = node.on} end,
  load = function(node, st) node.on = st.on == true end,
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
  -- loaded: the next step plays where it was
  save = function(node) return {v = node.v} end,
  load = function(node, st)
    if type(st.v) == "number" then node.v, node.fresh = st.v, true end
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

-- route: input 1 goes out of output 1 while input 2 is 0. If pick is 1
-- then output 1 is 0 and output 2 gets the input value.
-- (a toggle on input 2 picks which)
B.type("route", {
  inputs = 2, outputs = 2,
  init = function(node) node.second = node.old and node.old.second or false end,
  save = function(node) return {second = node.second} end,
  load = function(node, st) node.second = st.second == true end,
  input = function(node, i, v)
    if i == 2 then node.second = v ~= 0
    else B.out(node, node.second and 2 or 1, v) end
  end,
})

-- sample & hold: input 1 is watched quietly; a trigger on input 2 (not 0)
-- sends the value input 1 had then
B.type("sample", {
  inputs = 2, outputs = 1,
  init = function(node) node.v = node.old and node.old.v or 0 end,
  input = function(node, i, v)
    if i == 1 then node.v = v
    elseif v ~= 0 then B.out(node, 1, node.v) end
  end,
  save = function(node) return {v = node.v} end,
  load = function(node, st) if type(st.v) == "number" then node.v = st.v end end,
})

-- a fixed number: sent at the start, and again on anything at its input
B.type("constant", {
  inputs = 1, outputs = 1,
  start = function(node) B.out(node, 1, node.p.value or 0) end,
  input = function(node) B.out(node, 1, node.p.value or 0) end,
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

-- ------------------------------------------------------------- math

local function truth(c) return c and 1 or 0 end

local OPS = {
  ["+"] = function(a, b) return a + b end,
  ["-"] = function(a, b) return a - b end,
  ["*"] = function(a, b) return a * b end,
  ["/"] = function(a, b) return b ~= 0 and a / b or 0 end,
  ["mod"] = function(a, b) return b ~= 0 and a % b or 0 end,
  ["min"] = function(a, b) return math.min(a, b) end,
  ["max"] = function(a, b) return math.max(a, b) end,
  ["pow"] = function(a, b) return a ^ b end,
  [">"] = function(a, b) return truth(a > b) end,
  ["<"] = function(a, b) return truth(a < b) end,
  ["="] = function(a, b) return truth(a == b) end,
}

-- two numbers: input 1 computes and sends (a op b); input 2 sets b without
-- sending; until it does, b is the parameter (as in Max)
B.type("math", {
  inputs = 2, outputs = 1,
  init = function(node) node.b = node.p.b or 0 end,
  input = function(node, i, v)
    if i == 2 then
      node.b = v
      return
    end
    local op = OPS[node.p.op or "+"] or OPS["+"]
    B.out(node, 1, op(v, node.b))
  end,
})

local FUNCS = {
  sin = math.sin, cos = math.cos, tan = math.tan, abs = math.abs,
  neg = function(v) return -v end,
  ["not"] = function(v) return v == 0 and 1 or 0 end,
  sqrt = function(v) return math.sqrt(math.abs(v)) end,
  exp = math.exp,
  log = function(v) return v > 0 and math.log(v) or 0 end,
  floor = math.floor, ceil = math.ceil,
  round = function(v) return math.floor(v + 0.5) end,
}

-- one number in, one out; angles in radians (an LFO's 0..1 times 6.2832
-- is a full turn)
B.type("func", {
  inputs = 1, outputs = 1,
  input = function(node, _, v)
    local f = FUNCS[node.p.op or "sin"] or FUNCS.sin
    B.out(node, 1, f(v))
  end,
})

-- passes a value only when it differs from the last one
B.type("change", {
  inputs = 1, outputs = 1,
  input = function(node, _, v)
    if v == node.last then return end
    node.last = v
    B.out(node, 1, v)
  end,
})

-- ------------------------------------------------------------- memory

-- input 1 stores and sends; input 2 stores without sending; input 3 (not 0)
-- sends what's stored
B.type("memory", {
  inputs = 3, outputs = 1,
  init = function(node) node.v = node.p.start or 0 end,
  save = function(node) return {v = node.v} end,
  load = function(node, st) if type(st.v) == "number" then node.v = st.v end end,
  input = function(node, i, v)
    if i == 1 then
      node.v = v
      B.out(node, 1, v)
    elseif i == 2 then
      node.v = v
    elseif v ~= 0 then
      B.out(node, 1, node.v)
    end
  end,
})

-- named values shared by the whole patch, without wires: set var stores
-- and every get var of the same name sends it on
B.type("var_set", {
  inputs = 1,
  input = function(node, _, v)
    local name = node.p.name or "x"
    vars[name] = v
    for _, n in ipairs(listeners["var"] or {}) do
      if (n.p.name or "x") == name then B.out(n, 1, v) end
    end
  end,
})

B.type("var_get", {
  outputs = 1,
  init = function(node) node.listen("var") end,
  start = function(node)
    local v = vars[node.p.name or "x"]
    if v ~= nil then B.out(node, 1, v) end
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

-- ------------------------------------------------------------- screen blocks

-- The screen as a grid that matches the panel: four columns of 32 px under
-- E1-E4 and over K1-K4, and rows: top (what the encoders above do), middle
-- (or its top and bottom halves) and bottom (what the keys below do).
-- Each block sits in a row, a column and a span of columns.
local ROWS = {
  top = {0, 9}, middle = {10, 44}, ["middle top"] = {10, 22},
  ["middle bottom"] = {32, 22}, bottom = {55, 9},
}

local function area(node)
  local r = ROWS[node.p.where] or ROWS[node.def.where] or ROWS.middle
  local col = clamp(math.floor(node.p.col or 1), 1, 4)
  local span = clamp(math.floor(node.p.span or node.def.span or 1), 1, 5 - col)
  return (col - 1) * 32, r[1], span * 32, r[2]
end

local function norm(node, v)
  local lo, hi = node.p.lo or 0, node.p.hi or 127
  if hi == lo then return 0 end
  return clamp((v - lo) / (hi - lo), 0, 1)
end

local function fmt(v)
  if math.abs(v - round(v)) < 0.005 then return tostring(math.floor(round(v))) end
  return string.format(math.abs(v) < 10 and "%.2f" or "%.1f", v)
end

-- text cut to fit w and centred in it
local function text_in(x, y, w, s, c)
  s = tostring(s)
  while #s > 1 and screen_text_width(s) > w do s = s:sub(1, -2) end
  screen_text(x + (w - screen_text_width(s) + 1) // 2, y, s, c or 1)
end

-- B.type for a block that draws: def.draw(node, x, y, w, h); it's drawn
-- whenever anything on the screen changed
local function widget(name, def)
  local init, stop, draw = def.init, def.stop, def.draw
  def.paint = function(node) draw(node, area(node)) end
  def.init = function(node)
    node.v = node.p.start or node.p.lo or 0
    table.insert(widgets, node)
    if init then init(node) end
    screen_dirty = true
  end
  def.stop = function(node)
    for i = #widgets, 1, -1 do
      if widgets[i] == node then table.remove(widgets, i) end
    end
    if stop then stop(node) end
    screen_dirty = true
  end
  B.type(name, def)
end

-- a value in: keep it and redraw; `changed` marks a change after the first
-- (the start value), which an enc label shows as a number for a moment
local function take(node, _, v)
  if node.seen and v ~= node.v then node.changed = ticks end
  node.seen = true
  node.v = v
  screen_dirty = true
end

-- the name over an encoder, with its value as a line underneath; turning
-- it shows the number for a moment
widget("enc_label", {
  inputs = 1, where = "top",
  input = take,
  tick = function(node)
    if node.changed and ticks - node.changed == 40 then screen_dirty = true end
  end,
  draw = function(node, x, y, w, h)
    local recent = node.changed and ticks - node.changed < 40
    text_in(x, y, w - 2, recent and fmt(node.v) or (node.p.label or ""))
    local len = math.floor((w - 4) * norm(node, node.v) + 0.5)
    if len > 0 then screen_line(x + 1, y + h - 1, x + len, y + h - 1, 1) end
  end,
})

-- the name over a key: shown inverted while the input isn't 0
widget("key_label", {
  inputs = 1, where = "bottom",
  input = take,
  draw = function(node, x, y, w, h)
    if node.v ~= 0 then
      screen_rect(x + 1, y, w - 3, h, 1, true)
      text_in(x + 1, y + 1, w - 3, node.p.label or "", 0)
    else
      text_in(x + 1, y + 1, w - 3, node.p.label or "")
    end
  end,
})

-- a vertical bar, its value over it (when there's room) and its name under it
widget("slider", {
  inputs = 1, where = "middle",
  input = take,
  draw = function(node, x, y, w, h)
    local top = y + 1
    if h >= 30 then
      text_in(x, y, w - 2, fmt(node.v))
      top = y + 9
    end
    text_in(x, y + h - 8, w - 2, node.p.label or "")
    local bh = y + h - 9 - top
    if bh < 3 then return end
    local bw = math.min(10, w - 6)
    local bx = x + (w - bw) // 2
    screen_rect(bx, top, bw, bh, 1, false)
    local fill = math.floor((bh - 2) * norm(node, node.v) + 0.5)
    if fill > 0 then screen_rect(bx + 1, top + bh - 1 - fill, bw - 2, fill, 1, true) end
  end,
})

-- an arc from about 7 o'clock to 5 o'clock, the number inside, the name under
widget("knob", {
  inputs = 1, where = "middle",
  input = take,
  draw = function(node, x, y, w, h)
    local r = math.min(w, h - 9) // 2 - 1
    local cx, cy = x + w // 2, y + r + 1
    local a0, sweep = math.pi * 0.75, math.pi * 1.5
    local f = norm(node, node.v)
    -- the arc's corners sit at fixed angles (every 7.5 degrees), so a new
    -- value moves only the arc's end, not the pixels along it
    local N = 36
    local function at(k)
      local a = a0 + sweep * k / N
      return round(cx + r * math.cos(a)), round(cy + r * math.sin(a))
    end
    for k = 0, N, 3 do screen_pixel(at(k)) end
    local a1 = a0 + sweep * f
    local ex, ey = round(cx + r * math.cos(a1)), round(cy + r * math.sin(a1))
    local full = math.floor(f * N)
    local px, py = at(0)
    for k = 1, full do
      local nx, ny = at(k)
      screen_line(px, py, nx, ny, 1)
      px, py = nx, ny
    end
    screen_line(px, py, ex, ey, 1)
    -- the needle: from the centre to the arc; the number sits in the gap
    -- at the bottom of the arc, out of its way
    screen_line(cx, cy, ex, ey, 1)
    if r >= 8 then text_in(cx - r + 4, cy + r - 6, 2 * r - 7, fmt(node.v)) end
    text_in(x, y + h - 8, w - 2, node.p.label or "")
  end,
})

-- a name and a number
widget("number", {
  inputs = 1, where = "middle",
  input = take,
  draw = function(node, x, y, w, h)
    if h >= 18 then
      local top = y + (h - 18) // 2
      text_in(x, top, w - 2, node.p.label or "")
      text_in(x, top + 10, w - 2, fmt(node.v))
    else
      -- one line: the number always whole, the label shortened to fit
      local num, label = fmt(node.v), node.p.label or ""
      while #label > 0 and screen_text_width(label .. " " .. num) > w - 2 do label = label:sub(1, -2) end
      text_in(x, y + (h - 8) // 2, w - 2, label ~= "" and (label .. " " .. num) or num)
    end
  end,
})

-- the last values, scrolling from the right (25 a second at most)
local function graph_push(node, v)
  node.head = node.head + 1
  node.hist[node.head % 128] = v
  node.v = v
  screen_dirty = true
end

widget("graph", {
  inputs = 1, where = "middle", span = 2,
  init = function(node) node.hist, node.head = {}, 0 end,
  input = function(node, _, v) B.limit(node, v, graph_push, 2) end,
  draw = function(node, x, y, w, h)
    screen_text(x + 1, y, node.p.label or "", 1)
    local top, gh = y + 9, h - 10
    if gh < 3 then top, gh = y, h end
    local px
    for k = 0, w - 3 do
      local v = node.hist[(node.head - k) % 128]
      if v == nil then break end
      local py = top + gh - 1 - math.floor((gh - 1) * norm(node, v) + 0.5)
      local qx = x + w - 2 - k
      if px then screen_line(qx + 1, px, qx, py, 1) else screen_pixel(qx, py, 1) end
      px = py
    end
  end,
})

-- fixed words
widget("text", {
  where = "middle top",
  draw = function(node, x, y, w, h)
    text_in(x, y + (h - 8) // 2, w - 2, node.p.text or "")
  end,
})

-- steps: a step sequencer of up to 32 steps, each on or off with a note.
-- Input 1 is the playing step (1..n, e.g. from a counter): it sends the
-- step's number (output 3), its note (output 2), then, when the step is on,
-- a gate (output 1: 1, and 0 at the next step); the note comes first so a
-- midi note block plays it. Input 2 (a step number) turns a step on or off.
-- Input 3 takes steps (an encoder): it changes the note of the step whose
-- key is held, or was pressed in the last 2 seconds (press a step, then
-- dial its note); otherwise it transposes them all.
-- The keys it's given show a page of steps with their LEDs: a press turns
-- a step on or off; a press held while turning only edits. The page is the
-- one playing, unless input 4 picked one: each step there (an encoder's,
-- or a key's press) moves through auto, page 1, page 2... and back.
-- Input 5 sets how many steps play (1..64, e.g. from a value block); the
-- steps field is the length until it does. With "input 1 is" set to beat,
-- input 1 takes beats instead of step numbers: each 1 is the next step,
-- wrapping at the length, so no counter is needed and the length can change
-- while it plays.
local STEP_KEYS = {
  ["K1-K4"] = {1, 2, 3, 4}, ["K5-K8"] = {5, 6, 7, 8}, ["K10-K13"] = {10, 11, 12, 13},
  ["K5-K8 K10-K13"] = {5, 6, 7, 8, 10, 11, 12, 13},
}
local NOTE_NAMES = {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}

local function note_name(n)
  n = math.floor(n)
  return NOTE_NAMES[n % 12 + 1] .. (n // 12 - 1)
end

local function step_count(node) return clamp(math.floor(node.len or node.p.steps or 8), 1, 64) end

-- the step a key stands for, on the page shown
local function step_of_key(node, i)
  local keys = STEP_KEYS[node.p.keys] or {}
  local s = node.page * #keys + i
  if s <= step_count(node) then return s end
end

local function step_note(node, s) return node.notes[s] or node.p.note or 60 end

local function step_leds(node)
  if not key_led then return end
  local keys = STEP_KEYS[node.p.keys] or {}
  for i, k in ipairs(keys) do
    local s = step_of_key(node, i)
    if not s then key_led(k, 0, 0, 0)
    elseif node.held[i] ~= nil then key_led(k, 0, 200, 255)
    elseif node.pos == s then key_led(k, 255, 255, 255)
    elseif node.on[s] then key_led(k, 255, 120, 0)
    else key_led(k, 0, 0, 0) end
  end
  if #keys > 0 then key_led_refresh() end
end

local function step_toggle(node, s)
  if s < 1 or s > step_count(node) then return end
  node.on[s] = not node.on[s]
  screen_dirty = true
  step_leds(node)
end

-- something to show over the steps for a moment (an edit, a page)
local function step_flash(node, text)
  node.flash, node.edit_at = text, ticks
  screen_dirty = true
end

widget("steps", {
  inputs = 5, outputs = 3, where = "middle top", span = 4,
  init = function(node)
    local old = node.old
    node.on = old and old.on or {}
    node.notes = old and old.notes or {}
    node.page = old and old.page or 0
    node.pin = old and old.pin or nil   -- the page input 4 chose (nil: follow)
    node.len = old and old.len or nil   -- the length input 5 set (nil: the field)
    node.pos = old and old.pos or nil
    node.held = {}
    node.listen("key")
  end,
  start = function(node) step_leds(node) end,
  -- the pattern (on as a string of 0 and 1), the notes, the length, the page
  save = function(node)
    local last = 0
    for s = 1, 64 do if node.on[s] or node.notes[s] then last = s end end
    local on, notes = {}, {}
    for s = 1, last do
      on[s] = node.on[s] and "1" or "0"
      notes[s] = step_note(node, s)
    end
    return {on = table.concat(on), notes = notes, len = node.len, pin = node.pin}
  end,
  load = function(node, st)
    if type(st.on) == "string" then
      node.on = {}
      for s = 1, math.min(#st.on, 64) do node.on[s] = st.on:sub(s, s) == "1" end
    end
    if type(st.notes) == "table" then
      node.notes = {}
      for s, n in ipairs(st.notes) do node.notes[s] = n end
    end
    if type(st.len) == "number" then node.len = clamp(math.floor(st.len), 1, 64) end
    if type(st.pin) == "number" then node.pin, node.page = st.pin, st.pin end
    screen_dirty = true
  end,
  input = function(node, i, v)
    if i == 5 then
      -- the length: the steps that play (the pattern past it is kept)
      local len = clamp(math.floor(v + 0.5), 1, 64)
      if len == node.len then return end
      node.len = len
      local per = #(STEP_KEYS[node.p.keys] or {})
      if per > 0 then
        local pages = (len + per - 1) // per
        if node.pin and node.pin >= pages then node.pin = nil end
        if node.page >= pages then node.page = pages - 1 end
      end
      step_flash(node, len .. (len == 1 and " step" or " steps"))
      step_leds(node)
      return
    end
    if i == 4 then
      -- auto, page 1, page 2...: each step moves one along, wrapping
      local per = #(STEP_KEYS[node.p.keys] or {})
      if per == 0 or v == 0 then return end
      local pages = (step_count(node) + per - 1) // per
      local at = (node.pin or -1) + (v > 0 and 1 or -1)
      if at >= pages then at = -1 elseif at < -1 then at = pages - 1 end
      node.pin = at >= 0 and at or nil
      if node.pin then node.page = node.pin
      elseif node.pos then node.page = (node.pos - 1) // per end
      step_flash(node, node.pin and ("page " .. (node.pin + 1) .. "/" .. pages) or "page auto")
      step_leds(node)
      return
    end
    if i == 3 then
      -- a held key's step, the step pressed last (for 2 s), or all of them
      local any = false
      for k in pairs(node.held) do
        local s = step_of_key(node, k)
        if s then
          node.notes[s] = clamp(round(step_note(node, s) + v), 0, 127)
          node.held[k] = true
          node.edit_step, any = s, true
          node.recent = {s, ticks}
        end
      end
      if not any and node.recent and ticks - node.recent[2] < 100 then
        local s = node.recent[1]
        node.notes[s] = clamp(round(step_note(node, s) + v), 0, 127)
        node.recent[2] = ticks
        node.edit_step, any = s, true
      end
      if not any then
        for s = 1, step_count(node) do node.notes[s] = clamp(round(step_note(node, s) + v), 0, 127) end
        node.edit_step = 0
      end
      local s = node.edit_step or 0
      step_flash(node, s > 0 and (s .. ":" .. note_name(step_note(node, s))) or ("all " .. note_name(step_note(node, 1))))
      return
    end
    v = math.floor(v + 0.5)
    if i == 2 then
      if v ~= 0 then step_toggle(node, v) end
      return
    end
    if v == 0 then return end
    local n = step_count(node)
    if node.p.advance == "beat" then
      -- a beat: the next step (the first one after the start is step 1)
      node.pos = (node.pos or 0) % n + 1
    else
      node.pos = (v - 1) % n + 1
    end
    -- the keys follow the playing page, unless one is held or a page was chosen
    local per = #(STEP_KEYS[node.p.keys] or {})
    if per > 0 and not node.pin and next(node.held) == nil then node.page = (node.pos - 1) // per end
    if node.gate then
      node.gate = false
      B.out(node, 1, 0)
    end
    B.out(node, 3, node.pos)
    B.out(node, 2, step_note(node, node.pos))
    if node.on[node.pos] then
      node.gate = true
      B.out(node, 1, 1)
    end
    screen_dirty = true
    step_leds(node)
  end,
  event = function(node, _, k, z)
    for i, key in ipairs(STEP_KEYS[node.p.keys] or {}) do
      if key == k then
        if z == 1 then
          node.held[i] = false
        else
          -- a press without a turn turns the step on or off
          local s = step_of_key(node, i)
          if node.held[i] == false and s then step_toggle(node, s) end
          node.held[i] = nil
          -- the encoder edits this step for a moment after
          if s then node.recent = {s, ticks} end
        end
        step_leds(node)
      end
    end
  end,
  tick = function(node)
    if node.edit_at and ticks - node.edit_at == 40 then screen_dirty = true end
  end,
  stop = function(node)
    if node.gate then B.out(node, 1, 0) end
    if key_led then
      for _, k in ipairs(STEP_KEYS[node.p.keys] or {}) do key_led(k, 0, 0, 0) end
      key_led_refresh()
    end
  end,
  -- a bar per step, as tall as its note within lo..hi: filled when on, a
  -- mark at its height when off; under them the playing step and the page
  draw = function(node, x, y, w, h)
    local n = step_count(node)
    local cw = math.max(1, w // n)
    local gap = cw >= 6 and 2 or (cw >= 2 and 1 or 0)
    n = math.min(n, w // cw)
    local bh = math.max(3, h - 6)
    local base = y + bh
    local lo, hi = node.p.lo or 36, node.p.hi or 84
    for s = 1, n do
      local bx = x + (s - 1) * cw
      local f = hi ~= lo and clamp((step_note(node, s) - lo) / (hi - lo), 0, 1) or 0.5
      local th = 1 + math.floor((bh - 2) * f + 0.5)
      if node.on[s] then
        screen_rect(bx, base - th, cw - gap, th, 1, true)
      else
        screen_line(bx, base - th, bx + cw - gap - 1, base - th, 1)
      end
      if node.pos == s then screen_rect(bx, base + 2, cw - gap, 2, 1, true) end
    end
    screen_line(x, base, x + n * cw - gap - 1, base, 1)
    -- the page the keys show, when there's more than one
    local per = #(STEP_KEYS[node.p.keys] or {})
    if per > 0 and n > per and h >= 12 then
      local first = node.page * per
      local last = math.min(n, first + per)
      screen_line(x + first * cw, base + 5, x + last * cw - gap - 1, base + 5, 1)
      -- a page chosen by hand (not following): caps at its ends
      if node.pin then
        screen_line(x + first * cw, base + 3, x + first * cw, base + 5, 1)
        screen_line(x + last * cw - gap - 1, base + 3, x + last * cw - gap - 1, base + 5, 1)
      end
    end
    -- just edited (a step's note, the transpose, the page), for a moment
    if node.edit_at and ticks - node.edit_at < 40 and node.flash then
      local label = node.flash
      local tw = screen_text_width(label) + 2
      screen_rect(x + w - tw - 2, y, tw + 1, 9, 0, true)
      screen_rect(x + w - tw - 2, y, tw + 1, 9, 1, false)
      screen_text(x + w - tw - 1, y + 1, label, 1)
    end
  end,
})

-- prints to the REPL (diii's console), at most 10 a second
local function send_print(node, v)
  local text = math.type(v) == "float" and string.format("%.3f", v) or tostring(v)
  print((node.p.label or "") .. " " .. text)
end

-- watch: passes values on unchanged, and shows them in diii on the block
-- itself (the value and a little graph), at most 10 times a second
local function send_watch(node, v)
  local text = math.type(v) == "float" and string.format("%.4g", v) or tostring(v)
  print("^^pw(" .. node.id .. "," .. text .. ")")
end

B.type("watch", {
  inputs = 1, outputs = 1,
  input = function(node, _, v)
    B.out(node, 1, v)
    B.limit(node, v, send_watch, 5)
  end,
})

B.type("print", {
  inputs = 1,
  input = function(node, _, v) B.limit(node, v, send_print, 5) end,
})

print("blocks " .. B.version)
