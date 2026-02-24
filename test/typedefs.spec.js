/**
 * Runtime validation that TypeScript .d.ts declarations match the actual
 * JavaScript implementation. This catches drift like declaring a method
 * that doesn't exist (e.g. stop()) or missing a method that was added.
 *
 * The test parses the .d.ts files to extract declared class members, then
 * checks them against the real classes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "fs";
import NES from "../src/nes.js";
import Controller from "../src/controller.js";

/**
 * Parse a .d.ts file and extract declared members of a given class.
 * Returns { methods: string[], properties: string[], staticMembers: string[] }.
 */
function parseDtsClass(filePath, className) {
  const src = fs.readFileSync(filePath, "utf-8");

  // Find the class block
  const classRegex = new RegExp(
    `export\\s+class\\s+${className}\\s*\\{([\\s\\S]*?)\\n\\}`,
  );
  const match = src.match(classRegex);
  if (!match) {
    throw new Error(`Class ${className} not found in ${filePath}`);
  }
  const body = match[1];

  const methods = [];
  const properties = [];
  const staticMembers = [];

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    // Skip empty lines, comments, and constructor
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("constructor")
    ) {
      continue;
    }

    // Static members: "static readonly BUTTON_A = 0;"
    const staticMatch = trimmed.match(/^static\s+(?:readonly\s+)?(\w+)/);
    if (staticMatch) {
      staticMembers.push(staticMatch[1]);
      continue;
    }

    // Method or arrow-function property: "name: (...) => type" or "name(...): type"
    const memberMatch = trimmed.match(/^(\w+)\s*[:(]/);
    if (memberMatch) {
      const name = memberMatch[0].includes("(")
        ? memberMatch[1] // name(...): method syntax
        : memberMatch[1]; // name: property/arrow syntax

      // Distinguish methods (has parentheses in signature) from data properties
      if (trimmed.includes("=>") || trimmed.match(/^\w+\s*\(/)) {
        methods.push(name);
      } else {
        properties.push(name);
      }
      continue;
    }
  }

  return { methods, properties, staticMembers };
}

describe("TypeScript definitions match implementation", function () {
  describe("NES class (nes.d.ts)", function () {
    const dts = parseDtsClass("src/nes.d.ts", "NES");

    it("every declared method exists on the NES instance", function () {
      const nes = new NES({});
      for (const method of dts.methods) {
        assert.equal(
          typeof nes[method],
          "function",
          `nes.d.ts declares ${method}() but NES instance has no such method`,
        );
      }
    });

    it("NES instance has no public methods missing from declarations", function () {
      const nes = new NES({});
      const declared = new Set([...dts.methods, "constructor"]);
      // Collect methods from prototype and own properties (arrow functions)
      const actual = new Set();
      // Prototype methods
      for (const name of Object.getOwnPropertyNames(
        Object.getPrototypeOf(nes),
      )) {
        if (typeof nes[name] === "function") actual.add(name);
      }
      // Own properties that are functions (arrow function class fields)
      for (const name of Object.getOwnPropertyNames(nes)) {
        if (typeof nes[name] === "function") actual.add(name);
      }

      for (const method of actual) {
        // Skip private/internal members (prefixed with _)
        if (method.startsWith("_")) continue;
        assert.ok(
          declared.has(method),
          `NES has method ${method}() but it is not declared in nes.d.ts`,
        );
      }
    });
  });

  describe("Controller class (controller.d.ts)", function () {
    const dts = parseDtsClass("src/controller.d.ts", "Controller");

    it("every declared method exists on the Controller instance", function () {
      const ctrl = new Controller();
      for (const method of dts.methods) {
        assert.equal(
          typeof ctrl[method],
          "function",
          `controller.d.ts declares ${method}() but Controller instance has no such method`,
        );
      }
    });

    it("every declared static member exists on the Controller class", function () {
      for (const name of dts.staticMembers) {
        assert.notEqual(
          Controller[name],
          undefined,
          `controller.d.ts declares static ${name} but Controller.${name} is undefined`,
        );
      }
    });

    it("Controller has no public methods missing from declarations", function () {
      const ctrl = new Controller();
      const declared = new Set([...dts.methods, "constructor"]);
      const actual = new Set();
      for (const name of Object.getOwnPropertyNames(
        Object.getPrototypeOf(ctrl),
      )) {
        if (typeof ctrl[name] === "function") actual.add(name);
      }
      for (const name of Object.getOwnPropertyNames(ctrl)) {
        if (typeof ctrl[name] === "function") actual.add(name);
      }

      for (const method of actual) {
        if (method.startsWith("_")) continue;
        assert.ok(
          declared.has(method),
          `Controller has method ${method}() but it is not declared in controller.d.ts`,
        );
      }
    });

    it("Controller has no public static members missing from declarations", function () {
      const declaredStatic = new Set(dts.staticMembers);
      for (const name of Object.getOwnPropertyNames(Controller)) {
        // Skip standard static properties (prototype, length, name)
        if (["prototype", "length", "name"].includes(name)) continue;
        if (name.startsWith("_")) continue;
        assert.ok(
          declaredStatic.has(name),
          `Controller has static ${name} but it is not declared in controller.d.ts`,
        );
      }
    });
  });
});
