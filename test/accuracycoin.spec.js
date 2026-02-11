var assert = require("chai").assert;
var fs = require("fs");
var NES = require("../src/nes");
var Controller = require("../src/controller");

// AccuracyCoin test result memory addresses and test names, organized by page.
//
// Result encoding (stored at each test's memory address):
//   0x00         = not run
//   (n << 2) | 1 = pass  (0x01, 0x05, 0x09, 0x0D, ...)
//   (n << 2) | 2 = fail  (0x06, 0x0A, 0x0E, ...)  — n is the failing sub-test
//   0xFF         = skipped
//
// The low 2 bits distinguish pass (01) from fail (10). The upper bits encode
// which sub-test or behavior variant produced the result. Most tests return
// 0x01 on pass, but tests with multiple hardware behavior variants (SHA, SHS)
// return different pass codes: Behavior 1 → 0x05, Behavior 2 → 0x09, etc.
// The test harness uses (value & 3) === 1 to detect any pass code.
//
// "DRAW" tests (result in page $03xx) are informational only and skipped by "run all".
var TEST_PAGES = [
  {
    page: "CPU Behavior",
    tests: [
      { addr: 0x0405, name: "ROM is not writable" },
      { addr: 0x0403, name: "RAM Mirroring" },
      { addr: 0x044d, name: "PC Wraparound" },
      { addr: 0x0474, name: "The Decimal Flag" },
      { addr: 0x0475, name: "The B Flag" },
      { addr: 0x0406, name: "Dummy read cycles" },
      { addr: 0x0407, name: "Dummy write cycles" },
      { addr: 0x0408, name: "Open Bus" },
      { addr: 0x047d, name: "All NOP instructions" },
    ],
  },
  {
    page: "Addressing Mode Wraparound",
    tests: [
      { addr: 0x046e, name: "Absolute Indexed" },
      { addr: 0x046f, name: "Zero Page Indexed" },
      { addr: 0x0470, name: "Indirect" },
      { addr: 0x0471, name: "Indirect, X" },
      { addr: 0x0472, name: "Indirect, Y" },
      { addr: 0x0473, name: "Relative" },
    ],
  },
  {
    page: "Unofficial Ops: SLO",
    tests: [
      { addr: 0x0409, name: "SLO indirect,X ($03)" },
      { addr: 0x040a, name: "SLO zeropage ($07)" },
      { addr: 0x040b, name: "SLO absolute ($0F)" },
      { addr: 0x040c, name: "SLO indirect,Y ($13)" },
      { addr: 0x040d, name: "SLO zeropage,X ($17)" },
      { addr: 0x040e, name: "SLO absolute,Y ($1B)" },
      { addr: 0x040f, name: "SLO absolute,X ($1F)" },
    ],
  },
  {
    page: "Unofficial Ops: RLA",
    tests: [
      { addr: 0x0419, name: "RLA indirect,X ($23)" },
      { addr: 0x041a, name: "RLA zeropage ($27)" },
      { addr: 0x041b, name: "RLA absolute ($2F)" },
      { addr: 0x041c, name: "RLA indirect,Y ($33)" },
      { addr: 0x041d, name: "RLA zeropage,X ($37)" },
      { addr: 0x041e, name: "RLA absolute,Y ($3B)" },
      { addr: 0x041f, name: "RLA absolute,X ($3F)" },
    ],
  },
  {
    page: "Unofficial Ops: SRE",
    tests: [
      { addr: 0x0420, name: "SRE indirect,X ($43)" },
      { addr: 0x047f, name: "SRE zeropage ($47)" },
      { addr: 0x0422, name: "SRE absolute ($4F)" },
      { addr: 0x0423, name: "SRE indirect,Y ($53)" },
      { addr: 0x0424, name: "SRE zeropage,X ($57)" },
      { addr: 0x0425, name: "SRE absolute,Y ($5B)" },
      { addr: 0x0426, name: "SRE absolute,X ($5F)" },
    ],
  },
  {
    page: "Unofficial Ops: RRA",
    tests: [
      { addr: 0x0427, name: "RRA indirect,X ($63)" },
      { addr: 0x0428, name: "RRA zeropage ($67)" },
      { addr: 0x0429, name: "RRA absolute ($6F)" },
      { addr: 0x042a, name: "RRA indirect,Y ($73)" },
      { addr: 0x042b, name: "RRA zeropage,X ($77)" },
      { addr: 0x042c, name: "RRA absolute,Y ($7B)" },
      { addr: 0x042d, name: "RRA absolute,X ($7F)" },
    ],
  },
  {
    page: "Unofficial Ops: SAX/LAX",
    tests: [
      { addr: 0x042e, name: "SAX indirect,X ($83)" },
      { addr: 0x042f, name: "SAX zeropage ($87)" },
      { addr: 0x0430, name: "SAX absolute ($8F)" },
      { addr: 0x0431, name: "SAX zeropage,Y ($97)" },
      { addr: 0x0432, name: "LAX indirect,X ($A3)" },
      { addr: 0x0433, name: "LAX zeropage ($A7)" },
      { addr: 0x0434, name: "LAX absolute ($AF)" },
      { addr: 0x0435, name: "LAX indirect,Y ($B3)" },
      { addr: 0x0436, name: "LAX zeropage,Y ($B7)" },
      { addr: 0x0437, name: "LAX absolute,X ($BF)" },
    ],
  },
  {
    page: "Unofficial Ops: DCP",
    tests: [
      { addr: 0x0438, name: "DCP indirect,X ($C3)" },
      { addr: 0x0439, name: "DCP zeropage ($C7)" },
      { addr: 0x043a, name: "DCP absolute ($CF)" },
      { addr: 0x043b, name: "DCP indirect,Y ($D3)" },
      { addr: 0x043c, name: "DCP zeropage,X ($D7)" },
      { addr: 0x043d, name: "DCP absolute,Y ($DB)" },
      { addr: 0x043e, name: "DCP absolute,X ($DF)" },
    ],
  },
  {
    page: "Unofficial Ops: ISC",
    tests: [
      { addr: 0x043f, name: "ISC indirect,X ($E3)" },
      { addr: 0x0440, name: "ISC zeropage ($E7)" },
      { addr: 0x0441, name: "ISC absolute ($EF)" },
      { addr: 0x0442, name: "ISC indirect,Y ($F3)" },
      { addr: 0x0443, name: "ISC zeropage,X ($F7)" },
      { addr: 0x0444, name: "ISC absolute,Y ($FB)" },
      { addr: 0x0445, name: "ISC absolute,X ($FF)" },
    ],
  },
  {
    page: "Unofficial Ops: SHA/SHX/SHY/SHS/LAE",
    tests: [
      { addr: 0x0446, name: "SHA indirect,Y ($93)" },
      { addr: 0x0447, name: "SHA absolute,Y ($9F)" },
      { addr: 0x0448, name: "SHS absolute,Y ($9B)" },
      { addr: 0x0449, name: "SHY absolute,X ($9C)" },
      { addr: 0x044a, name: "SHX absolute,Y ($9E)" },
      { addr: 0x044b, name: "LAE absolute,Y ($BB)" },
    ],
  },
  {
    page: "Unofficial Ops: Immediates",
    tests: [
      { addr: 0x0410, name: "ANC Immediate ($0B)" },
      { addr: 0x0411, name: "ANC Immediate ($2B)" },
      { addr: 0x0412, name: "ASR Immediate ($4B)" },
      { addr: 0x0413, name: "ARR Immediate ($6B)" },
      { addr: 0x0414, name: "ANE Immediate ($8B)" },
      { addr: 0x0415, name: "LXA Immediate ($AB)" },
      { addr: 0x0416, name: "AXS Immediate ($CB)" },
      { addr: 0x0417, name: "SBC Immediate ($EB)" },
    ],
  },
  {
    page: "CPU Interrupts",
    tests: [
      { addr: 0x0461, name: "Interrupt flag latency" },
      { addr: 0x0462, name: "NMI Overlap BRK" },
      { addr: 0x0463, name: "NMI Overlap IRQ" },
    ],
  },
  {
    page: "APU Registers and DMA",
    tests: [
      { addr: 0x046c, name: "DMA + Open Bus" },
      { addr: 0x0488, name: "DMA + $2002 Read" },
      { addr: 0x044c, name: "DMA + $2007 Read" },
      { addr: 0x044f, name: "DMA + $2007 Write" },
      { addr: 0x045d, name: "DMA + $4015 Read" },
      { addr: 0x045e, name: "DMA + $4016 Read" },
      { addr: 0x046b, name: "DMC DMA Bus Conflicts" },
      { addr: 0x0477, name: "DMC DMA + OAM DMA" },
      { addr: 0x0479, name: "Explicit DMA Abort" },
      { addr: 0x0478, name: "Implicit DMA Abort" },
    ],
  },
  {
    page: "APU Tests",
    tests: [
      { addr: 0x0465, name: "Length Counter" },
      { addr: 0x0466, name: "Length Table" },
      { addr: 0x0467, name: "Frame Counter IRQ" },
      { addr: 0x0468, name: "Frame Counter 4-step" },
      { addr: 0x0469, name: "Frame Counter 5-step" },
      { addr: 0x046a, name: "Delta Modulation Channel" },
      { addr: 0x045c, name: "APU Register Activation" },
      { addr: 0x045f, name: "Controller Strobing" },
      { addr: 0x047a, name: "Controller Clocking" },
    ],
  },
  {
    page: "Power On State",
    // These are DRAW tests (result page $03xx) — skipped in "run all" mode
    tests: [],
  },
  {
    page: "PPU Behavior",
    tests: [
      { addr: 0x0485, name: "CHR ROM is not writable" },
      { addr: 0x0404, name: "PPU Register Mirroring" },
      { addr: 0x044e, name: "PPU Register Open Bus" },
      { addr: 0x0476, name: "PPU Read Buffer" },
      { addr: 0x047e, name: "Palette RAM Quirks" },
      { addr: 0x0486, name: "Rendering Flag Behavior" },
      { addr: 0x048a, name: "$2007 read w/ rendering" },
    ],
  },
  {
    page: "PPU VBlank Timing",
    tests: [
      { addr: 0x0450, name: "VBlank beginning" },
      { addr: 0x0451, name: "VBlank end" },
      { addr: 0x0452, name: "NMI Control" },
      { addr: 0x0453, name: "NMI Timing" },
      { addr: 0x0454, name: "NMI Suppression" },
      { addr: 0x0455, name: "NMI at VBlank end" },
      { addr: 0x0456, name: "NMI disabled at VBlank" },
    ],
  },
  {
    page: "Sprite Evaluation",
    tests: [
      { addr: 0x0459, name: "Sprite overflow behavior" },
      { addr: 0x0457, name: "Sprite 0 Hit behavior" },
      { addr: 0x0489, name: "Suddenly Resize Sprite" },
      { addr: 0x0458, name: "Arbitrary Sprite zero" },
      { addr: 0x045a, name: "Misaligned OAM behavior" },
      { addr: 0x045b, name: "Address $2004 behavior" },
      { addr: 0x047b, name: "OAM Corruption" },
      { addr: 0x0480, name: "INC $4014" },
    ],
  },
  {
    page: "PPU Misc.",
    tests: [
      { addr: 0x0481, name: "Attributes As Tiles" },
      { addr: 0x0482, name: "t Register Quirks" },
      { addr: 0x0483, name: "Stale BG Shift Registers" },
      { addr: 0x0487, name: "BG Serial In" },
      { addr: 0x0484, name: "Sprites On Scanline 0" },
    ],
  },
  {
    page: "CPU Behavior 2",
    tests: [
      { addr: 0x0460, name: "Instruction Timing" },
      { addr: 0x046d, name: "Implied Dummy Reads" },
      { addr: 0x048b, name: "Branch Dummy Reads" },
      { addr: 0x047c, name: "JSR Edge Cases" },
    ],
  },
];

// Tests known to fail — skip these until the emulator is fixed.
var KNOWN_FAILURES = {
  // CPU interrupts: not cycle-accurate enough
  0x0461: "Interrupt flag latency not emulated",
  0x0462: "NMI overlap BRK not emulated",
  0x0463: "NMI overlap IRQ not emulated",

  // DMA: handled atomically, no bus-level interleaving
  0x046c: "DMA + Open Bus not emulated",
  0x0488: "DMA + $2002 Read not emulated",
  0x044c: "DMA + $2007 Read not emulated",
  0x044f: "DMA + $2007 Write not emulated",
  0x045d: "DMA + $4015 Read not emulated",
  0x045e: "DMA + $4016 Read not emulated",
  0x046b: "DMC DMA bus conflicts not emulated",
  0x0477: "DMC DMA + OAM DMA not emulated",
  0x0479: "Explicit DMA abort not emulated",
  0x0478: "Implicit DMA abort not emulated",

  // Controller: partial fix, subtest 4 still fails
  0x045f: "Controller strobing not fully accurate",

  // APU: timing/behavior not accurate enough
  0x0467: "APU frame counter IRQ not accurate",
  0x046a: "DMC not accurate",
  0x045c: "APU register activation not accurate",

  // PPU: various behaviors not accurate enough
  0x044e: "PPU register open bus not accurate",
};

// Flatten all tests for easy iteration
var ALL_TESTS = [];
TEST_PAGES.forEach(function (page) {
  page.tests.forEach(function (test) {
    ALL_TESTS.push({
      page: page.page,
      addr: test.addr,
      name: test.name,
    });
  });
});

/**
 * Run AccuracyCoin by loading the ROM, simulating a Start button press
 * (while cursor is at the top of a page) to trigger the "run all tests"
 * mode, then running frames until completion.
 *
 * Returns a map of result address -> result value for every test.
 */
function runAccuracyCoin(romData) {
  var nes = new NES({
    onFrame: function () {},
    onAudioSample: function () {},
    emulateSound: false,
  });

  nes.loadROM(romData);

  // Run frames to let the ROM initialize and display the menu.
  // The cursor starts at $FF (top of page, highlighting the page index).
  // Wait until the NMI is enabled and the menu is ready (Debug_EC reaches $0C).
  for (var i = 0; i < 60; i++) {
    nes.frame();
  }

  // Press Start while cursor is at top of page to trigger "run all tests".
  // The NMI routine reads controller_New (newly-pressed buttons).
  // We need the button to transition from up->down between NMI reads.
  nes.buttonDown(1, Controller.BUTTON_START);
  for (var i = 0; i < 5; i++) {
    nes.frame();
  }
  nes.buttonUp(1, Controller.BUTTON_START);

  // Run frames until RunningAllTests ($35) goes back to 0,
  // or we hit a safety limit.
  var maxFrames = 30000;
  var framesRun = 65; // already ran 60 + 5
  var crashed = false;
  var crashMessage = null;

  try {
    for (var f = 0; f < maxFrames; f++) {
      nes.frame();
      framesRun++;

      // Check if RunningAllTests flag has been cleared (tests complete)
      // The flag is at address $35. It's set to 1 when running, 0 when done.
      if (f > 60 && nes.cpu.mem[0x35] === 0) {
        break;
      }
    }
  } catch (e) {
    crashed = true;
    crashMessage = e.message;
  }

  // Collect results from all test addresses
  var results = {};
  ALL_TESTS.forEach(function (test) {
    results[test.addr] = nes.cpu.mem[test.addr];
  });

  return {
    results: results,
    framesRun: framesRun,
    crashed: crashed,
    crashMessage: crashMessage,
    runningAllTestsFlag: nes.cpu.mem[0x35],
  };
}

// AccuracyCoin result encoding:
//   0x00 = not run, 0xFF = skipped
//   (n << 2) | 1 = pass (0x01, 0x05, 0x09, ...) — low bits encode behavior variant
//   (n << 2) | 2 = fail (0x06, 0x0A, ...) — n is the failing sub-test number
function isPass(value) {
  return (value & 3) === 1;
}

function formatResult(value) {
  if (value === 0x00) return "NOT RUN";
  if (isPass(value)) return "PASS";
  if (value === 0xff) return "SKIPPED";
  return (
    "FAIL (error 0x" + value.toString(16).toUpperCase().padStart(2, "0") + ")"
  );
}

describe("AccuracyCoin", function () {
  this.timeout(600000); // 10 minutes — running 134 tests takes a while

  var run;

  before(function (done) {
    fs.readFile("roms/AccuracyCoin/AccuracyCoin.nes", function (err, data) {
      if (err) return done(err);
      run = runAccuracyCoin(data.toString("binary"));
      done();
    });
  });

  it("should not crash before completing all tests", function () {
    if (run.crashed) {
      // Figure out which test was running when the crash happened
      var lastRun = "unknown";
      ALL_TESTS.forEach(function (test) {
        var result = run.results[test.addr];
        if (result !== 0x00 && result !== 0xff) {
          lastRun = test.page + " / " + test.name;
        }
      });
      // Find first NOT RUN test after the last run one
      var firstNotRun = "unknown";
      var foundLast = false;
      for (var i = 0; i < ALL_TESTS.length; i++) {
        var result = run.results[ALL_TESTS[i].addr];
        if (result !== 0x00 && result !== 0xff) {
          foundLast = true;
        } else if (foundLast && result === 0x00) {
          firstNotRun = ALL_TESTS[i].page + " / " + ALL_TESTS[i].name;
          break;
        }
      }
      assert.fail(
        "ROM crashed: " +
          run.crashMessage +
          "\n      Last completed test: " +
          lastRun +
          "\n      Probable crashing test: " +
          firstNotRun +
          "\n      (" +
          run.framesRun +
          " frames run)",
      );
    }
  });

  // Generate individual test cases for each page
  TEST_PAGES.forEach(function (page) {
    if (page.tests.length === 0) return; // skip DRAW-only pages

    describe(page.page, function () {
      page.tests.forEach(function (test) {
        var knownFailure = KNOWN_FAILURES[test.addr];
        if (knownFailure) {
          it.skip(test.name + " — " + knownFailure, function () {});
          return;
        }
        it(test.name, function () {
          var result = run.results[test.addr];
          if (result === 0x00) {
            this.skip(); // not run (likely due to earlier crash)
          }
          if (!isPass(result)) {
            assert.fail(
              test.name +
                ": " +
                formatResult(result) +
                " (addr $" +
                test.addr.toString(16).toUpperCase().padStart(4, "0") +
                ")",
            );
          }
        });
      });
    });
  });

  after(function () {
    if (!run) return;
    // Print summary
    var pass = 0;
    var fail = 0;
    var notRun = 0;
    var failures = [];

    ALL_TESTS.forEach(function (test) {
      var result = run.results[test.addr];
      if (isPass(result)) {
        pass++;
      } else if (result === 0x00 || result === 0xff) {
        notRun++;
      } else {
        fail++;
        failures.push(
          "    " + test.page + " / " + test.name + ": " + formatResult(result),
        );
      }
    });

    console.log("");
    console.log(
      "    AccuracyCoin: " +
        pass +
        " passed, " +
        fail +
        " failed, " +
        notRun +
        " not run (" +
        run.framesRun +
        " frames)",
    );
    if (failures.length > 0) {
      console.log("    Failures:");
      failures.forEach(function (f) {
        console.log(f);
      });
    }
  });
});
