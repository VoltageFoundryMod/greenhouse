-- blocks.lua: the runtime for diii's patch editor (docs/VISUAL-EDITOR.md)
--
-- The core and the blocks any iii device can run. A device's own blocks
-- are in a module loaded after this one: blocks_achene.lua (encoders, keys,
-- the screen), blocks_grid.lua (grid widgets). diii uploads the core and
-- the module for the device; a saved patch requires what it uses. Split so
-- that iii can compile each file in the memory of an RP2040.
--
-- A patch is nodes joined by wires; messages are numbers pushed along the
-- wires when something happens. diii uploads this file and builds patches
-- with B.node / B.wire (live) or B.patch{...} (a saved patch file).

-- Loaded again (diii sends a newer copy): stop the copy that's running
-- first, or its clock and patch would carry on beside this one.
if B and B.clear then B.clear() end
B = B or {}
B.version = 8
B.types = B.types or {} -- kept: a module's types outlive a reload of the core

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
        B.ticks = ticks
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
  if B.screen_clear then B.screen_clear() end
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

-- ------------------------------------------------------------- helpers

local function round(v) return math.floor(v + 0.5) end
B.round = round
B.ticks = ticks

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
B.SCALES = SCALES

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
