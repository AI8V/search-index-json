// This file runs before each test file, ensuring mocks are globally available.

// Mock Chart.js
const mockChartInstance = {
    update: jest.fn(),
    destroy: jest.fn(),
    data: { labels: [], datasets: [] },
    canvas: { id: 'mock-chart' }
};
global.Chart = jest.fn(() => mockChartInstance);

// Mock HTMLCanvasElement.prototype.getContext
if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
        // Return a mock context object. It can be empty for our purposes.
    }));
}

// Mock Bootstrap
global.bootstrap = {
    Toast: jest.fn().mockImplementation(() => ({ show: jest.fn() })),
    Modal: jest.fn().mockImplementation(() => ({ show: jest.fn(), hide: jest.fn() })),
    Collapse: jest.fn(),
};
bootstrap.Modal.getInstance = jest.fn().mockImplementation(() => ({ hide: jest.fn() }));