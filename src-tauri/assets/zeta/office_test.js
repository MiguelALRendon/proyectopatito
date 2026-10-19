'use strict';

const pendingTests = new Map();
let testCounter = 0;

workerEvents['test-result'] = (message) => {
  const resolve = pendingTests.get(message.testId);
  pendingTests.delete(message.testId);
  if (resolve) resolve(message);
};

function callWorker(cmd, payload) {
  return new Promise((resolve) => {
    testCounter += 1;
    pendingTests.set(testCounter, resolve);
    zetaPort.postMessage({ cmd, testId: testCounter, ...payload });
  });
}

window.__officeTest = {
  insert: (text) => callWorker('test-insert', { text }),
  read: () => callWorker('test-read', {}),
  windowSize: () => callWorker('test-window-size', {}),
  dispatch: (url) => callWorker('test-dispatch', { url }),
};
