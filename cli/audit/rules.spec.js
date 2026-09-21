import test from "node:test";
import assert from "node:assert";
import { auditCode } from "./rules.js";

test("Audit Rules: flags repetitive dispatch switch statement as CONTROL_FLOW_DISPATCH_SWITCH", () => {
  const code = `
export const resolveColor = (type) => {
  switch (type) {
    case "primary":
      return "blue";
    case "secondary":
      return "gray";
    case "danger":
      return "red";
    case "warning":
      return "yellow";
    default:
      return "white";
  }
};
`;

  const violations = auditCode(code, "src/utils/colors.js", "src/utils/colors.js");
  const dispatchViolation = violations.find((v) => v.rule === "CONTROL_FLOW_DISPATCH_SWITCH");
  assert.ok(dispatchViolation, "Expected CONTROL_FLOW_DISPATCH_SWITCH violation");
  assert.strictEqual(dispatchViolation.severity, "MEDIUM");
  assert.ok(dispatchViolation.hazard.includes("Dispatch switch smell detected"));
});

test("Audit Rules: does NOT flag non-dispatch complex switch statements", () => {
  const code = `
export const processOrder = (status, order) => {
  switch (status) {
    case "pending": {
      validatePayment(order);
      sendNotification(order.userId);
      return queueForFulfillment(order);
    }
    case "completed": {
      archiveOrder(order);
      emitAnalytics("order_completed", order);
      break;
    }
    default:
      throw new Error("Invalid status");
  }
};
`;

  const violations = auditCode(code, "src/order.js", "src/order.js");
  const dispatchViolation = violations.find((v) => v.rule === "CONTROL_FLOW_DISPATCH_SWITCH");
  assert.strictEqual(dispatchViolation, undefined, "Complex switch should not be flagged as dispatch smell");
});

test("Audit Rules: clean keyed map implementation produces 0 violations", () => {
  const code = `
const COLOR_MAP = {
  primary: "blue",
  secondary: "gray",
  danger: "red",
  warning: "yellow"
};

export const resolveColor = (type) => {
  return Object.prototype.hasOwnProperty.call(COLOR_MAP, type) ? COLOR_MAP[type] : "white";
};
`;

  const violations = auditCode(code, "src/utils/colors.js", "src/utils/colors.js");
  const dispatchViolation = violations.find((v) => v.rule === "CONTROL_FLOW_DISPATCH_SWITCH");
  assert.strictEqual(dispatchViolation, undefined);
});

test("Audit Security: flags external link target=_blank missing rel=noopener noreferrer in JSX", () => {
  const code = `
export const ExternalLink = () => (
  <a href="https://example.com" target="_blank">External</a>
);
`;
  const violations = auditCode(code, "src/Link.tsx", "src/Link.tsx");
  const violation = violations.find((v) => v.rule === "SECURITY_REVERSE_TABNABBING");
  assert.ok(violation, "Expected SECURITY_REVERSE_TABNABBING violation in JSX");
  assert.strictEqual(violation.severity, "MEDIUM");
});

test("Audit Security: passes external link with rel=noopener noreferrer in JSX", () => {
  const code = `
export const ExternalLink = () => (
  <a href="https://example.com" target="_blank" rel="noopener noreferrer">External</a>
);
`;
  const violations = auditCode(code, "src/Link.tsx", "src/Link.tsx");
  const violation = violations.find((v) => v.rule === "SECURITY_REVERSE_TABNABBING");
  assert.strictEqual(violation, undefined);
});

test("Audit Security: flags target=_blank missing rel in Vue template", () => {
  const code = `
<template>
  <a href="https://example.com" target="_blank">External</a>
</template>
`;
  const violations = auditCode(code, "src/Link.vue", "src/Link.vue");
  const violation = violations.find((v) => v.rule === "SECURITY_REVERSE_TABNABBING");
  assert.ok(violation, "Expected SECURITY_REVERSE_TABNABBING in Vue template");
});

test("Audit Security: flags javascript: pseudo-protocol in JSX href", () => {
  const code = `
export const BadLink = () => (
  <a href="javascript:alert(1)">Click Me</a>
);
`;
  const violations = auditCode(code, "src/BadLink.tsx", "src/BadLink.tsx");
  const violation = violations.find((v) => v.rule === "SECURITY_JAVASCRIPT_URL");
  assert.ok(violation, "Expected SECURITY_JAVASCRIPT_URL violation");
  assert.strictEqual(violation.severity, "CRITICAL");
});

test("Audit Security: flags javascript: in template attributes", () => {
  const code = `
<template>
  <form action="javascript:void(0)">
    <button type="submit">Submit</button>
  </form>
</template>
`;
  const violations = auditCode(code, "src/Form.vue", "src/Form.vue");
  const violation = violations.find((v) => v.rule === "SECURITY_JAVASCRIPT_URL");
  assert.ok(violation, "Expected SECURITY_JAVASCRIPT_URL in template");
});

test("Audit Security: flags dynamic code execution via eval()", () => {
  const code = `
export const runDynamic = (str: string) => {
  return eval(str);
};
`;
  const violations = auditCode(code, "src/eval.ts", "src/eval.ts");
  const violation = violations.find((v) => v.rule === "SECURITY_DYNAMIC_CODE_EXECUTION");
  assert.ok(violation, "Expected SECURITY_DYNAMIC_CODE_EXECUTION for eval()");
  assert.strictEqual(violation.severity, "CRITICAL");
});

test("Audit Security: flags dynamic code execution via new Function()", () => {
  const code = `
export const buildFn = (code: string) => {
  return new Function("return " + code);
};
`;
  const violations = auditCode(code, "src/fn.ts", "src/fn.ts");
  const violation = violations.find((v) => v.rule === "SECURITY_DYNAMIC_CODE_EXECUTION");
  assert.ok(violation, "Expected SECURITY_DYNAMIC_CODE_EXECUTION for new Function()");
  assert.strictEqual(violation.severity, "CRITICAL");
});

test("Audit Security: flags string-based execution in setTimeout", () => {
  const code = `
export const scheduleCode = () => {
  setTimeout("alert('hello')", 1000);
};
`;
  const violations = auditCode(code, "src/timer.ts", "src/timer.ts");
  const violation = violations.find((v) => v.rule === "SECURITY_DYNAMIC_CODE_EXECUTION");
  assert.ok(violation, "Expected SECURITY_DYNAMIC_CODE_EXECUTION for string setTimeout");
});

test("Audit Security: does NOT flag function callback setTimeout", () => {
  const code = `
export const scheduleCode = () => {
  const timer = setTimeout(() => {
    // legitimate callback
  }, 1000);
  return () => clearTimeout(timer);
};
`;
  const violations = auditCode(code, "src/timer.ts", "src/timer.ts");
  const violation = violations.find((v) => v.rule === "SECURITY_DYNAMIC_CODE_EXECUTION");
  assert.strictEqual(violation, undefined);
});

test("Audit Security: flags sensitive variable logging in console", () => {
  const code = `
export const debugAuth = (authToken: string, user: any) => {
  console.log("Authenticated with token:", authToken);
  console.info("User details:", { password: user.password });
};
`;
  const violations = auditCode(code, "src/auth.ts", "src/auth.ts");
  const loggingViolations = violations.filter((v) => v.rule === "SECURITY_SENSITIVE_LOGGING");
  assert.strictEqual(loggingViolations.length >= 1, true, "Expected SECURITY_SENSITIVE_LOGGING violation");
  assert.strictEqual(loggingViolations[0].severity, "HIGH");
});

test("Audit Security: does NOT flag normal non-sensitive console logging", () => {
  const code = `
export const debugCount = (itemCount: number) => {
  console.log("Items rendered:", itemCount);
};
`;
  const violations = auditCode(code, "src/items.ts", "src/items.ts");
  const violation = violations.find((v) => v.rule === "SECURITY_SENSITIVE_LOGGING");
  assert.strictEqual(violation, undefined);
});

test("Audit Hook Shape Contract: passes flat hook with 4 actions, 2 state fields, 1 status field (7 total)", () => {
  const code = `
export const useTodoList = () => {
  const items = ref([]);
  const filter = ref("all");
  const isLoading = ref(false);

  const addItem = (item) => { items.value.push(item); };
  const toggleItem = (id) => { /* toggle */ };
  const removeItem = (id) => { /* remove */ };
  const setFilter = (next) => { filter.value = next; };

  return {
    items,
    filter,
    isLoading,
    addItem,
    toggleItem,
    removeItem,
    setFilter
  };
};
`;
  const violations = auditCode(code, "src/useTodoList.ts", "src/useTodoList.ts");
  const shapeViolation = violations.find((v) => v.rule === "HOOK_SHAPE_CONTRACT");
  assert.strictEqual(shapeViolation, undefined, "Expected HOOK_SHAPE_CONTRACT to pass for flat 7-property hook");

  const overloadViolation = violations.find((v) => v.rule === "HOOK_RETURN_OVERLOAD");
  assert.ok(overloadViolation, "Expected deprecated HOOK_RETURN_OVERLOAD warning");
  assert.strictEqual(overloadViolation.severity, "MEDIUM", "Expected downgraded warning severity for HOOK_RETURN_OVERLOAD");
});

test("Audit Hook Shape Contract: fails hook with actions nested under actions wrapper", () => {
  const code = `
export const useTodoList = () => {
  const items = ref([]);
  const filter = ref("all");
  const isLoading = ref(false);

  const addItem = (item) => { items.value.push(item); };
  const toggleItem = (id) => { /* toggle */ };
  const removeItem = (id) => { /* remove */ };
  const setFilter = (next) => { filter.value = next; };

  return {
    items,
    filter,
    isLoading,
    actions: {
      addItem,
      toggleItem,
      removeItem,
      setFilter
    }
  };
};
`;
  const violations = auditCode(code, "src/useTodoList.ts", "src/useTodoList.ts");
  const shapeViolation = violations.find((v) => v.rule === "HOOK_SHAPE_CONTRACT");
  assert.ok(shapeViolation, "Expected HOOK_SHAPE_CONTRACT failure for nested action wrapper");
  assert.strictEqual(shapeViolation.severity, "HIGH");
  assert.ok(shapeViolation.hazard.includes("actions"));
});

test("Audit Hook Shape Contract: flags raw DOM ref in hook return", () => {
  const code = `
export const useDropdown = () => {
  const isOpen = ref(false);
  const containerRef = ref(null);
  const toggleDropdown = () => { isOpen.value = !isOpen.value; };

  return {
    isOpen,
    containerRef,
    toggleDropdown
  };
};
`;
  const violations = auditCode(code, "src/useDropdown.ts", "src/useDropdown.ts");
  const shapeViolation = violations.find((v) => v.rule === "HOOK_SHAPE_CONTRACT");
  assert.ok(shapeViolation, "Expected HOOK_SHAPE_CONTRACT failure for raw DOM ref");
  assert.strictEqual(shapeViolation.severity, "HIGH");
  assert.ok(shapeViolation.hazard.includes("containerRef"));
});

test("Audit Hook Shape Contract: flags non-verb action handler in hook return", () => {
  const code = `
export const useCounter = () => {
  const count = ref(0);
  const onToggle = () => { count.value += 1; };

  return {
    count,
    onToggle
  };
};
`;
  const violations = auditCode(code, "src/useCounter.ts", "src/useCounter.ts");
  const shapeViolation = violations.find((v) => v.rule === "HOOK_SHAPE_CONTRACT");
  assert.ok(shapeViolation, "Expected HOOK_SHAPE_CONTRACT failure for onToggle");
  assert.strictEqual(shapeViolation.severity, "HIGH");
  assert.ok(shapeViolation.hazard.includes("onToggle"));
});

test("Audit Hook Shape Contract: flags cross-hook naming inconsistency for loading state", () => {
  const code = `
export const useFirst = () => {
  const items = ref([]);
  const isLoading = ref(false);
  const fetchItems = () => {};
  return { items, isLoading, fetchItems };
};

export const useSecond = () => {
  const user = ref(null);
  const loading = ref(false);
  const fetchUser = () => {};
  return { user, loading, fetchUser };
};
`;
  const violations = auditCode(code, "src/useMulti.ts", "src/useMulti.ts");
  const inconsistentViolation = violations.find(
    (v) => v.rule === "HOOK_SHAPE_CONTRACT" && v.hazard.includes("loading")
  );
  assert.ok(inconsistentViolation, "Expected cross-hook naming inconsistency failure for loading vs isLoading");
  assert.strictEqual(inconsistentViolation.severity, "HIGH");
  assert.ok(inconsistentViolation.hazard.includes("isLoading"));
});

