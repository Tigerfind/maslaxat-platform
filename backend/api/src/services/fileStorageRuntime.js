'use strict';

const { Readable } = require('stream');
const { loadEnv } = require('../config/env');
const objectStorageModule = require('./objectStorage');
const { createFileStorageService } = require('./fileStorageService');

function createTestObjectStorage() {
  const objects = new Map();
  const client = {
    async send(command) {
      const { Key } = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        if (objects.has(Key)) {
          throw Object.assign(new Error('Object exists'), {
            name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 },
          });
        }
        objects.set(Key, {
          body: Buffer.from(command.input.Body),
          contentType: command.input.ContentType,
          metadata: command.input.Metadata,
        });
        return {};
      }
      const stored = objects.get(Key);
      if (!stored) {
        throw Object.assign(new Error('Object not found'), {
          name: 'NoSuchKey', $metadata: { httpStatusCode: 404 },
        });
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        return {
          ContentLength: stored.body.length,
          ContentType: stored.contentType,
          Metadata: stored.metadata,
        };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        return {
          Body: Readable.from([stored.body]),
          ContentLength: stored.body.length,
          ContentType: stored.contentType,
          Metadata: stored.metadata,
        };
      }
      if (command.constructor.name === 'DeleteObjectCommand') {
        objects.delete(Key);
        return {};
      }
      throw new Error('Unsupported test object-storage command');
    },
  };
  return objectStorageModule.createObjectStorage({ client, bucket: 'test-private-files' });
}

let service;
let objectStorageService;

function getObjectStorageService() {
  if (objectStorageService) return objectStorageService;
  const env = loadEnv(process.env);
  objectStorageService = env.nodeEnv === 'test' ? createTestObjectStorage() : objectStorageModule;
  return objectStorageService;
}

function getFileStorageService() {
  if (service) return service;
  const env = loadEnv(process.env);
  const objectStorage = getObjectStorageService();
  service = createFileStorageService({
    objectStorage,
    writeMode: env.fileStorage.writeMode,
    localFallback: env.fileStorage.localFallback,
    localRoot: env.fileStorage.localRoot,
  });
  return service;
}

module.exports = { getFileStorageService, getObjectStorageService };
