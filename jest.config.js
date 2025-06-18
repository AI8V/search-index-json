module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['./jest.setup.js'], // ✅ THE FIX: Run setup file before tests
};