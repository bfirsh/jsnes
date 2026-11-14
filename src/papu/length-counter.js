// Length counter timing quirks shared by the square, triangle and noise
// channels.
//
// The frame counter clocks the length counters on a particular CPU cycle.
// In this emulator the APU is clocked at the start of each CPU cycle,
// before that cycle's register write, so a write made on the cycle just
// before the clock happens "before" it. On real hardware, though, both of
// these writes still behave as if they came after the clock:
//
//   - Changing the halt flag ($4000/$4004/$400C bit 5, $4008 bit 7) only
//     takes effect after the clock, so the clock uses the old flag.
//   - Reloading the length counter ($4003/$4007/$400B/$400F) is ignored if
//     the clock decrements the counter (i.e. it was non-zero and not
//     halted); if the clock does nothing, the reload works and isn't
//     decremented.
//
// So we remember the cycle (papu.cycle) and old value of the last halt
// change and reload, and the clock looks at those when the write was on the
// previous cycle. Tested by blargg's 2005 APU tests 10.len_halt_timing and
// 11.len_reload_timing. See https://www.nesdev.org/wiki/APU_Length_Counter

export function initLengthCounter(ch) {
  ch.lengthCounter = 0;
  ch.lengthCounterEnable = false;
  ch.haltWriteCycle = -1;
  ch.prevLengthEnable = false;
  ch.reloadCycle = -1;
  ch.prevLength = 0;
}

// Set the length counter enable (= not halted) flag from a register write.
export function writeLengthEnable(ch, enable) {
  ch.haltWriteCycle = ch.papu.cycle;
  ch.prevLengthEnable = ch.lengthCounterEnable;
  ch.lengthCounterEnable = enable;
}

// Reload the length counter from a register write (only works while the
// channel is enabled in $4015).
export function writeLengthReload(ch, value) {
  if (!ch.isEnabled) return;
  ch.reloadCycle = ch.papu.cycle;
  ch.prevLength = ch.lengthCounter;
  ch.lengthCounter = ch.papu.getLengthMax(value & 0xf8);
}

// Clock the length counter. Returns true if it reached 0.
export function clockLength(ch) {
  const prevCycle = ch.papu.cycle - 1;
  const enabled =
    ch.haltWriteCycle === prevCycle
      ? ch.prevLengthEnable
      : ch.lengthCounterEnable;
  if (ch.reloadCycle === prevCycle) {
    if (enabled && ch.prevLength > 0) {
      // The reload is lost: the clock decrements the old value.
      ch.lengthCounter = ch.prevLength - 1;
      return ch.lengthCounter === 0;
    }
    return false;
  }
  if (enabled && ch.lengthCounter > 0) {
    ch.lengthCounter--;
    return ch.lengthCounter === 0;
  }
  return false;
}
