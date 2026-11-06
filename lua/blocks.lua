-- blocks.lua: the runtime for diii's patch editor (docs/VISUAL-EDITOR.md)
--
-- A patch is nodes joined by wires; messages are numbers pushed along the
-- wires when something happens. diii uploads this file and builds patches
-- with B.node / B.wire (live) or B.patch{...} (a saved patch file).

B = B or {}
B.version = 1
B.types = {}

local nodes = {}      -- id -> node
local listeners = {}  -- event name -> list of nodes
local tickers = {}    -- nodes with a tick
local tick_metro = nil
local TICK = 1 / 50

-- ------------------------------------------------------------- core

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
  event_midi = function(a, b, c) dispatch("midi", a, b, c) end
  if not tick_metro then
    tick_metro = metro.init(function()
      for _, node in ipairs(tickers) do node.def.tick(node, TICK) end
      if B.redraw then B.redraw() end
    end, TICK)
  end
  if tick_metro then tick_metro:start() end
end

function B.clear()
  for id in pairs(nodes) do remove(id) end
  listeners, tickers = {}, {}
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

-- ------------------------------------------------------------- blocks

-- sources

B.type("encoder", {
  outputs = 1,
  init = function(node) node.listen("enc") end,
  event = function(node, _, n, d)
    if n == node.p.n then B.out(node, 1, d) end
  end,
})

B.type("key", {
  outputs = 1,
  init = function(node) node.listen("key") end,
  event = function(node, _, n, z)
    if n == node.p.n then B.out(node, 1, z) end
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

-- processors

B.type("accum", {
  inputs = 1, outputs = 1,
  init = function(node) node.v = node.p.start or 64 end,
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

-- outputs

B.type("midi_cc", {
  inputs = 1,
  input = function(node, _, v)
    local value = clamp(math.floor(v + 0.5), 0, 127)
    if value == node.last then return end
    node.last = value
    midi_cc(node.p.cc or 1, value, node.p.ch or 1)
  end,
})

B.type("midi_note", {
  inputs = 1,
  input = function(node, _, v)
    local note, ch = node.p.note or 60, node.p.ch or 1
    if v ~= 0 and not node.on then
      node.on = true
      midi_note_on(note, node.p.vel or 100, ch)
    elseif v == 0 and node.on then
      node.on = false
      midi_note_off(note, 0, ch)
    end
  end,
  stop = function(node)
    if node.on then midi_note_off(node.p.note or 60, 0, node.p.ch or 1) end
  end,
})

local COLOURS = {
  white = {255, 255, 255}, red = {255, 0, 0}, amber = {255, 120, 0},
  green = {0, 255, 60}, cyan = {0, 200, 255}, blue = {0, 40, 255}, pink = {255, 0, 120},
}

B.type("key_led", {
  inputs = 1,
  input = function(node, _, v)
    if not key_led then return end
    local c = COLOURS[node.p.colour or "white"] or COLOURS.white
    local b = clamp(v, 0, 1)
    key_led(node.p.n or 1, math.floor(c[1] * b), math.floor(c[2] * b), math.floor(c[3] * b))
    key_led_refresh()
  end,
  stop = function(node)
    if key_led then key_led(node.p.n or 1, 0, 0, 0) key_led_refresh() end
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

print("blocks " .. B.version)
