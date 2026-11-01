import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCSharpCode, maskCommentsAndStrings } from "./csharp-analyzer.js";
import { calculateAiSlopScore, calculateMolecularHealthScore } from "./metrics.js";
import { auditCode } from "./rules.js";

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

// Ported from ae78a51 (endLine, quoted text), 7f485f8, a0ff222 and 7c30410: C# shallow catches go
// through the same chemx-allow post-filter as JS, so these rows run auditCode on a .cs path.
const csharpCatchHits = (code) => auditCode(code, "Services/CacheWarmer.cs", "Services/CacheWarmer.cs", { config: {} })
  .filter((v) => v.rule === "AI_SLOP_SHALLOW_CATCH");

const wrapCSharpCatch = (catchBlock, above = "") => `
public class CacheWarmer
{
    public void Run()
    {
        try
        {
            Warm();
        }
${above}${catchBlock}
    }
}
`;

test("csharp-analyzer: a best-effort annotation anywhere in a multi-line catch exempts it", () => {
  const placements = [
    wrapCSharpCatch("        catch (Exception)\n        {\n            // chemx-allow: best-effort warmup is optional\n        }"),
    wrapCSharpCatch("        catch (Exception)\n        {\n        }", "        // chemx-allow: best-effort warmup is optional\n"),
    wrapCSharpCatch("        catch (Exception) { } // chemx-allow: best-effort warmup is optional"),
    wrapCSharpCatch("        catch (Exception)\n        {\n        } // chemx-allow: best-effort warmup is optional"),
    wrapCSharpCatch("        catch (Exception)\n        {\n            /* chemx-allow: best-effort\n             * warmup is optional */\n        }")
  ];
  for (const code of placements) {
    assert.deepEqual(csharpCatchHits(code), [], code);
  }
});

test("csharp-analyzer: annotation text in a string on the catch line does not exempt it", () => {
  const quoted = "        catch (Exception) { } Log(\"chemx-allow: best-effort quoted, not a comment\");";
  assert.equal(csharpCatchHits(wrapCSharpCatch(quoted)).length, 1);
});

test("csharp-analyzer: a Stroustrup annotation trailing the try block brace exempts the catch", () => {
  const placements = [
    "try {\n    X();\n} // chemx-allow: best-effort reason\ncatch { }\n",
    "try {\n    X();\n} /* chemx-allow: best-effort reason */\ncatch { }\n",
    "try\n{\n    X();\n} // chemx-allow: best-effort reason\ncatch (Exception)\n{\n}\n",
    "try {\n    Log(\"}{\");\n} // chemx-allow: best-effort braces in strings are masked\ncatch { }\n"
  ];
  for (const code of placements) {
    assert.deepEqual(csharpCatchHits(code), [], code);
    assert.deepEqual(csharpCatchHits(code.replace(/\n/g, "\r\n")), [], code);
  }
});

test("csharp-analyzer: a commented brace that closes an inner catch or another block does not exempt", () => {
  const innerCatch = "try {\n    try { X(); } catch {\n    } // chemx-allow: best-effort inner\n} catch { }\n";
  assert.deepEqual(csharpCatchHits(innerCatch).map((hit) => hit.line), [4]);
  const ifBlock = "try {\n    if (a) {\n        X();\n    } // chemx-allow: best-effort reason\n} catch { }\n";
  assert.deepEqual(csharpCatchHits(ifBlock).map((hit) => hit.line), [5]);
});

test("csharp-analyzer: a reasonless or punctuation-only annotation is flagged and says so", () => {
  for (const code of [
    wrapCSharpCatch("        catch (Exception) { } // chemx-allow: best-effort"),
    wrapCSharpCatch("        catch (Exception) { } // chemx-allow: best-effort ..."),
    wrapCSharpCatch("        catch (Exception) { }", "        /* chemx-allow: best-effort */\n").replace(/\n/g, "\r\n")
  ]) {
    const hits = csharpCatchHits(code);
    assert.equal(hits.length, 1, code);
    assert.ok(hits[0].hazard.includes("needs a reason"), hits[0].hazard);
  }
  const ish = csharpCatchHits(wrapCSharpCatch("        catch (Exception) { } // chemx-allow: best-effort-ish reason"));
  assert.equal(ish.length, 1);
  assert.equal(ish[0].hazard.includes("needs a reason"), false, ish[0].hazard);
});

test("csharp-analyzer: punctuation after best-effort still reads as the annotation (C1)", () => {
  assert.deepEqual(csharpCatchHits(wrapCSharpCatch("        catch (Exception) { } // chemx-allow: best-effort, warmup is optional")), []);
  const bare = csharpCatchHits(wrapCSharpCatch("        catch (Exception) { } // chemx-allow: best-effort."));
  assert.equal(bare.length, 1);
  assert.ok(bare[0].hazard.includes("needs a reason"), bare[0].hazard);
});

const wrapCSharpMethod = (body) => `public class CacheWarmer\n{\n    public void Run()\n    {\n${body}\n    }\n}\n`;

test("csharp-analyzer: a block annotation above a one-line try counts when its closer is on a later line (SC-4)", () => {
  for (const above of [
    "        /* chemx-allow: best-effort warmup is optional\n         */",
    "        /*\n         * chemx-allow: best-effort warmup is optional\n         */"
  ]) {
    const code = wrapCSharpMethod(`${above}\n        try { Warm(); } catch { }`);
    assert.deepEqual(csharpCatchHits(code), [], code);
  }
});

// C4 for C#: annotation ownership by column; catchColumn is the 0-based column of the catch keyword.
const csharpCatchColumns = (code) => csharpCatchHits(code).map((hit) => [hit.line, hit.catchColumn]);

test("csharp-analyzer: a one-line nested try annotated after the outer try brace exempts only the outer catch (C4)", () => {
  const code = "try { try { X(); } catch { } } // chemx-allow: best-effort outer reason\ncatch { }\n";
  assert.deepEqual(csharpCatchColumns(code), [[1, code.indexOf("catch")]]);
});

test("csharp-analyzer: two tries on one line are owned by column, not by line (C4)", () => {
  const trailing = "try { X(); } catch { } try { Y(); } catch { } // chemx-allow: best-effort second is optional\n";
  assert.deepEqual(csharpCatchColumns(trailing), [[1, trailing.indexOf("catch")]]);
  const above = "// chemx-allow: best-effort first is optional\ntry { X(); } catch { } try { Y(); } catch { }\n";
  assert.deepEqual(csharpCatchColumns(above), [[2, above.split("\n")[1].lastIndexOf("catch")]]);
});

test("csharp-analyzer: two shallow catches on one line are two findings at their catch columns (C4)", () => {
  const twoOnOneLine = wrapCSharpMethod("        try { A(); } catch { } try { B(); } catch { }");
  const line = twoOnOneLine.split("\n")[4];
  const columns = (code) => csharpCatchHits(code).map((hit) => [hit.line, hit.column]);
  assert.deepEqual(columns(twoOnOneLine), [[5, line.indexOf("catch")], [5, line.lastIndexOf("catch")]]);
  const firstAnnotated = wrapCSharpMethod("        try { A(); } catch { } /* chemx-allow: best-effort a */ try { B(); } catch { }");
  assert.deepEqual(columns(firstAnnotated), [[5, firstAnnotated.split("\n")[4].lastIndexOf("catch")]]);
  const multiLine = wrapCSharpCatch("        catch (Exception)\n        {\n        }");
  assert.deepEqual(columns(multiLine), [[10, "        ".length]]);
});

// C5: the scan reads masked content (comments and strings blanked, offsets kept), so a body that
// holds only comments is empty, a when filter may sit before it, and quoted catch text never counts.
test("csharp-analyzer: a comment-only body or a when filter is still a shallow catch (C5)", () => {
  for (const catchBlock of [
    "        catch (Exception) { /* swallow */ }",
    "        catch (Exception)\n        {\n            // swallow\n            // and log nothing\n        }",
    "        catch (Exception ex) when (ex is IOException) { }",
    "        catch (Exception ex) when (Check(ex, \")\")) { }",
    "        catch when (ShouldSwallow()) { /* swallow */ }",
    "        catch (Exception ex)\n            when (ex is IOException)\n        {\n        }"
  ]) {
    for (const code of [wrapCSharpCatch(catchBlock), wrapCSharpCatch(catchBlock).replace(/\n/g, "\r\n")]) {
      const hits = csharpCatchHits(code);
      const lastLine = 10 + (catchBlock.match(/\n/g) || []).length;
      assert.deepEqual(hits.map((hit) => [hit.line, hit.endLine, hit.tryLine, hit.severity]), [[10, lastLine, 6, "MEDIUM"]], code);
    }
  }
});

test("csharp-analyzer: a filtered catch with a statement, or catch text in a string or comment, is not shallow (C5)", () => {
  for (const catchBlock of [
    "        catch (Exception ex) when (ex is IOException) { Log(ex); }",
    "        catch (Exception) { /* swallow */ Log(); }",
    "        finally { Log(\"catch {}\"); } // catch (Exception) { }"
  ]) {
    assert.deepEqual(csharpCatchHits(wrapCSharpCatch(catchBlock)), [], catchBlock);
  }
});

test("csharp-analyzer: comment-only and filtered catches honour a best-effort annotation (C5)", () => {
  const placements = [
    wrapCSharpCatch("        catch (Exception) { /* chemx-allow: best-effort warmup is optional */ }"),
    wrapCSharpCatch("        catch (Exception ex) when (ex is IOException) { } // chemx-allow: best-effort warmup is optional"),
    wrapCSharpCatch("        catch (Exception ex) when (ex is IOException)\n        {\n            // chemx-allow: best-effort warmup is optional\n        }"),
    wrapCSharpCatch("        catch (Exception ex) when (ex is IOException) { }", "        // chemx-allow: best-effort warmup is optional\n"),
    "try {\n    X();\n} // chemx-allow: best-effort reason\ncatch (Exception ex) when (ex is IOException) { }\n"
  ];
  for (const code of placements) {
    assert.deepEqual(csharpCatchHits(code), [], code);
    assert.deepEqual(csharpCatchHits(code.replace(/\n/g, "\r\n")), [], code);
  }
});

test("csharp-analyzer: a reasonless annotation in a comment-only body is flagged and says so (C5)", () => {
  for (const catchBlock of [
    "        catch (Exception) { /* chemx-allow: best-effort */ }",
    "        catch (Exception ex) when (ex is IOException)\n        {\n            /* chemx-allow: best-effort */\n        }"
  ]) {
    for (const code of [wrapCSharpCatch(catchBlock), wrapCSharpCatch(catchBlock).replace(/\n/g, "\r\n")]) {
      const hits = csharpCatchHits(code);
      assert.equal(hits.length, 1, code);
      assert.ok(hits[0].hazard.includes("needs a reason"), hits[0].hazard);
    }
  }
});
