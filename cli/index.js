#!/usr/bin/env node
const startTime = Date.now();

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { createWatcher } = require('./watcher');
const createReporter = require('./reporter');
const createState = require('./state');
const parseOptions = require('./options');
const colorApi = require('../util/color-api');

const { getState, createIteration } = createState();
const options = parseOptions(process.argv.slice(2));

const createOnMessage = (iterationApi, reporter) => {
  return (fileName, message) => {
    if (message.type === 'pass') {
      iterationApi.addPass(fileName, message.title);
      reporter.pass(getState(), fileName);
    } else if (message.type === 'fail') {
      iterationApi.addFail(fileName, message.title, message.error);
      reporter.fail(getState(), fileName);
    } else if (message.type === 'report') {
      iterationApi.addReport(fileName, message.payload);
      reporter.report(getState(), fileName);
    }
  };
};

const createChildrenApi = (childrenLength) => {
  const children = [];

  const killChildren = ar => ar.forEach(child => {
    childrenLength--;
    child.kill();
  });

  return {
    addChild: (child) => { children.push(child); },
    removeChild: (child) => {
      killChildren(children.filter(item => item.pid === child.pid));
    },
    leftCount: () => childrenLength,
    cancel: () => {
      killChildren(children);
    }
  };
};

const execTests = () => {
  const reporter = createReporter(colorApi);
  const childrenApi = createChildrenApi(options.testFiles.length);
  const iterationApi = createIteration();
  const onMessage = createOnMessage(iterationApi, reporter);
  let canceled = false;

  const disconnect = (child) => {
    childrenApi.removeChild(child);
    if (childrenApi.leftCount() <= 0 && !canceled) {
      reporter.finish(getState());
    }
  };

  const cancel = () => {
    canceled = true;
    childrenApi.cancel();
    reporter.cancel();
  };

  options.testFiles.forEach((testFile) => {
    const childArgs = [ testFile ];
    if (options.require.length) {
      childArgs.push(`--require=${options.require.join(',')}`);
    }
    const child = cp.fork(path.join(__dirname, 'execute'), childArgs);
    childrenApi.addChild(child);
    child.on('message', (message) => { if (!canceled) onMessage(testFile, message); });
    child.on('disconnect', () => disconnect(child));
  });

  return {
    isRunning: () => childrenApi.leftCount() >= 1,
    cancel
  };
};

process.on('exit', () => {
  console.log(colorApi.cyan(`\n${Date.now() - startTime}ms execution time`));
});

const logChanges = files => {
  console.log('');
  console.log(colorApi.blackCyanBackground(` Watcher: ${files.join(', ')} `));
  console.log('');
};

if (options.isWatchMode) {
  let execApi;
  createWatcher(fs, setInterval, files => {
    logChanges(files);
    if (execApi && execApi.isRunning()) execApi.cancel();
    execApi = execTests();
  });
}

execTests();
