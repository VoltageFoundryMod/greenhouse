-- blocks_achene.lua: achene's parts of the runtime for greenhouse's patch
-- editor: encoders, pushes, keys and their LEDs, and the screen blocks.
-- They follow blocks.lua's parts, which they build on (see there).

-- ------------------------------------------------------------- screen
--@part screen

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
  if not screen_dirty or not screen_clear or B.ticks % 2 == 1 then return end
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

-- ------------------------------------------------------------- controls

--@part encoder
B.type("encoder", {
  outputs = 1,
  init = function(node) node.listen("enc") end,
  event = function(node, _, n, d)
    if n == node.p.n then B.out(node, 1, d) end
  end,
})

--@part enc_push
B.type("enc_push", {
  outputs = 1,
  init = function(node) node.listen("enc_key") end,
  event = function(node, _, n, z)
    if n == node.p.n then B.out(node, 1, z) end
  end,
})

--@part key
B.type("key", {
  outputs = 1,
  init = function(node) node.listen("key") end,
  event = function(node, _, n, z)
    if n == node.p.n then B.out(node, 1, z) end
  end,
})

--@part key_led
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

--@part display needs screen
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

--@part widgets needs screen
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
  if node.seen and v ~= node.v then node.changed = B.ticks end
  node.seen = true
  node.v = v
  screen_dirty = true
end

--@part enc_label needs widgets screen
-- the name over an encoder, with its value as a line underneath; turning
-- it shows the number for a moment
widget("enc_label", {
  inputs = 1, where = "top",
  input = take,
  tick = function(node)
    if node.changed and B.ticks - node.changed == 40 then screen_dirty = true end
  end,
  draw = function(node, x, y, w, h)
    local recent = node.changed and B.ticks - node.changed < 40
    text_in(x, y, w - 2, recent and fmt(node.v) or (node.p.label or ""))
    local len = math.floor((w - 4) * norm(node, node.v) + 0.5)
    if len > 0 then screen_line(x + 1, y + h - 1, x + len, y + h - 1, 1) end
  end,
})

--@part key_label needs widgets
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

--@part slider needs widgets
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

--@part knob needs widgets
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

--@part number needs widgets
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

--@part graph needs screen widgets
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

--@part text needs widgets
-- fixed words
widget("text", {
  where = "middle top",
  draw = function(node, x, y, w, h)
    text_in(x, y + (h - 8) // 2, w - 2, node.p.text or "")
  end,
})

--@part steps needs screen widgets
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
  node.flash, node.edit_at = text, B.ticks
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
          node.recent = {s, B.ticks}
        end
      end
      if not any and node.recent and B.ticks - node.recent[2] < 100 then
        local s = node.recent[1]
        node.notes[s] = clamp(round(step_note(node, s) + v), 0, 127)
        node.recent[2] = B.ticks
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
          if s then node.recent = {s, B.ticks} end
        end
        step_leds(node)
      end
    end
  end,
  tick = function(node)
    if node.edit_at and B.ticks - node.edit_at == 40 then screen_dirty = true end
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
    if node.edit_at and B.ticks - node.edit_at < 40 and node.flash then
      local label = node.flash
      local tw = screen_text_width(label) + 2
      screen_rect(x + w - tw - 2, y, tw + 1, 9, 0, true)
      screen_rect(x + w - tw - 2, y, tw + 1, 9, 1, false)
      screen_text(x + w - tw - 1, y + 1, label, 1)
    end
  end,
})
