import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCSharpCode, maskCommentsAndStrings } from "./csharp-analyzer.js";
import { calculateAiSlopScore, calculateMolecularHealthScore } from "./metrics.js";

test("csharp-analyzer: maskCommentsAndStrings preserves layout and line count", () => {
  const code = "// comment\n/* block */\nstring s = \"hello\";\n";
  const masked = maskCommentsAndStrings(code);
  assert.equal(masked.split("\n").length, code.split("\n").length);
  assert.equal(masked.includes("hello"), false);
});

test("csharp-analyzer: flags global simulation switches with isAiSlop: true", () => {
  const code = `
namespace Nadena.Domain;

public class MarketSimulator
{
    public static bool SimulateBuyers = true;
    public static bool SimulateOrders { get; set; } = true;
    private static bool UseSimulation = true;
}
`;

  const violations = [];
  analyzeCSharpCode(code, "Domain/MarketSimulator.cs", violations);

  const slopMatches = violations.filter((v) => v.rule === "AI_SLOP_LAZY_PLACEHOLDER" && v.isAiSlop);
  assert.ok(slopMatches.length >= 3, "Must flag all 3 simulation switches");
  assert.equal(slopMatches[0].severity, "CRITICAL");
  assert.ok(slopMatches[0].hazard.includes("SimulateBuyers"));

  // Verify AI Slop scoring calculation is degraded
  const slopScore = calculateAiSlopScore(violations, 1);
  assert.ok(slopScore.score < 90, "AI Slop score must drop from 100");
  assert.notEqual(slopScore.grade, "A+");
});

test("csharp-analyzer: detects deep control flow nesting (>= 4 levels) in methods", () => {
  const code = `
namespace Nadena.Services;

public class OrderProcessor
{
    public async Task ProcessAsync(Order order)
    {
        if (order != null)
        {
            if (order.IsValid)
            {
                if (order.HasItems)
                {
                    if (order.Total > 0)
                    {
                        if (order.IsPaid)
                        {
                            await SaveAsync(order);
                        }
                    }
                }
            }
        }
    }
}
`;

  const violations = [];
  analyzeCSharpCode(code, "Services/OrderProcessor.cs", violations);

  const nestingViolation = violations.find((v) => v.rule === "STRUCTURAL_WEIGHT_EXCEEDED");
  assert.ok(nestingViolation, "Must flag excessive control flow nesting depth");
  assert.ok(nestingViolation.hazard.includes("nesting depth"));
  assert.equal(nestingViolation.severity, "HIGH");
});

test("csharp-analyzer: detects high cyclomatic complexity (> 12) in methods", () => {
  const code = `
namespace Nadena.Services;

public class ComplexEvaluator
{
    public int EvaluateScore(int a, int b, int c, int d, int e, int f)
    {
        int score = 0;
        if (a > 1) score++;
        if (b > 2) score++;
        if (c > 3) score++;
        if (d > 4) score++;
        if (e > 5) score++;
        if (f > 6) score++;
        if (a == b) score++;
        if (b == c) score++;
        if (c == d) score++;
        if (d == e) score++;
        if (e == f) score++;
        if (a + b > 10) score++;
        if (c + d > 10) score++;
        return score;
    }
}
`;

  const violations = [];
  analyzeCSharpCode(code, "Services/ComplexEvaluator.cs", violations);

  const complexityViolation = violations.find((v) => v.rule === "COMPLEXITY_CYCLOMATIC_HIGH");
  assert.ok(complexityViolation, "Must flag cyclomatic complexity > 12");
  assert.ok(complexityViolation.hazard.includes("EvaluateScore"));
});

test("csharp-analyzer: detects complex inline boolean conditions in control flow", () => {
  const code = `
namespace Nadena.Services;

public class Validator
{
    public bool Check(Item item)
    {
        if (item.A && item.B && item.C || item.D)
        {
            return true;
        }
        return false;
    }
}
`;

  const violations = [];
  analyzeCSharpCode(code, "Services/Validator.cs", violations);

  const inlineBool = violations.find((v) => v.rule === "CONTROL_FLOW_INLINE_BOOLEAN");
  assert.ok(inlineBool, "Must flag complex inline boolean condition with >= 3 operators");
});

test("csharp-analyzer: flags Clean Architecture layer violations in controllers", () => {
  const controllerCode = `
namespace Nadena.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly IOrderService _orderService;

    public OrdersController(AppDbContext context, IOrderService orderService)
    {
        _context = context;
        _orderService = orderService;
    }

    [HttpGet]
    public IActionResult GetDirect([FromServices] ApplicationDbContext inlineDb)
    {
        return Ok();
    }
}
`;

  const violations = [];
  analyzeCSharpCode(controllerCode, "Controllers/OrdersController.cs", violations);

  const layerViolations = violations.filter((v) => v.rule === "LAYER_VIOLATION_CONTROLLER");
  assert.ok(layerViolations.length >= 2, "Must flag constructor DbContext and [FromServices] DbContext");
  assert.equal(layerViolations[0].severity, "CRITICAL");
});

test("csharp-analyzer: flags excessive controller constructor injection (> 5 dependencies)", () => {
  const controllerCode = `
namespace Nadena.Controllers;

public class HeavyController : ControllerBase
{
    public HeavyController(
        IAuthService auth,
        IUserService user,
        IOrderService order,
        IEmailService email,
        IPaymentService payment,
        ILogger<HeavyController> logger)
    {
    }
}
`;

  const violations = [];
  analyzeCSharpCode(controllerCode, "Controllers/HeavyController.cs", violations);

  const coupling = violations.find((v) => v.rule === "COUPLING_EXCESSIVE_INJECTION");
  assert.ok(coupling, "Must flag constructor with 6 dependencies");
  assert.equal(coupling.severity, "HIGH");
});

test("csharp-analyzer: flags SQLite test provider in tests/configuration", () => {
  const testCode = `
using Microsoft.EntityFrameworkCore;
using Xunit;

public class OrderTests
{
    [Fact]
    public void TestDatabase()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;
    }
}
`;

  const violations = [];
  analyzeCSharpCode(testCode, "Tests/OrderTests.cs", violations);

  const sqliteViolation = violations.find((v) => v.rule === "SYNTHETIC_MOCK_DATA" && v.hazard.includes("SQLite"));
  assert.ok(sqliteViolation, "Must flag UseSqlite/DataSource=:memory: provider");
});
