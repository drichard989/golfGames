# Golf Games Test Suite

## Running Tests

### Quick Start
Open `test.html` in your browser:
```bash
open test.html
# or
python3 -m http.server 8000
# then visit http://localhost:8000/test.html
```

The tests run automatically on page load and display results in the browser.

## Test Coverage

### Current Test Suites

1. **strokesOnHoleHalfAware - Full Pops**
   - Zero handicap handling
   - Standard stroke allocation (1-18 handicap)
   - High handicaps (36+)
   - Plus handicaps (negative)

2. **strokesOnHoleHalfAware - Half Pops**
   - Fractional stroke allocation (0.5 per stroke)
   - Verification across all handicap ranges
   - Plus handicap fractional strokes

3. **Net Score Calculation - Real Scenario**
   - Hole 9 calculations (the reported bug case)
   - Daniel's natural birdie vs net scores
   - Full pops vs half pops comparison

4. **Adjusted Handicaps (Play Off Low)**
   - Multiple players with mixed handicaps
   - Plus handicap adjustments
   - Edge cases (all same, all different)

5. **Edge Cases**
   - Very high handicaps (54+)
   - Negative handicaps
   - Zero gross scores

## Adding New Tests

```javascript
describe('Your Test Suite Name', () => {
  it('should do something specific', () => {
    const result = yourFunction(input);
    assertEqual(result, expected);
  });
  
  it('should handle edge case', () => {
    assert(condition, 'Error message if fails');
  });
});
```

### Available Assertions

- `assert(condition, message)` - Basic boolean assertion
- `assertEqual(actual, expected, message)` - Strict equality
- `assertAlmostEqual(actual, expected, tolerance, message)` - For floating point (default tolerance: 0.001)

## Test Philosophy

- **Unit tests** for core calculation functions (strokes, net scores, handicaps)
- **Integration tests** for real-world scenarios (actual scorecard data)
- **Regression tests** for bugs that were fixed (like the half pops issue)

## Extending Tests

To test new game modes (Vegas, Banker, Junk):

1. Copy the relevant function logic into `test.html`
2. Create mock data matching your scorecard structure
3. Add new `describe()` blocks with specific test cases
4. Verify edge cases and known bug scenarios

## CI/CD Integration

For automated testing, you can use:
- Puppeteer/Playwright for headless browser tests
- GitHub Actions to run tests on push
- Add test coverage reporting

Example GitHub Action workflow coming soon.
