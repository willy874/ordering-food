import { badRequest, wrap } from '../lib/errors.js';
import {
  bulkStatusSchema,
  createGroupSchema,
  manageCodeSchema,
  parse,
  parseIntId,
  patchGroupSchema,
} from '../lib/validate.js';
import * as groupService from '../services/groupService.js';
import { readCredentials } from './http.js';

export const create = wrap(async (req, res) => {
  const input = parse(createGroupSchema, req.body);
  res.status(201).json(await groupService.createGroup(input));
});

/** 現在還收得了單的團，給首頁列出來 */
export const listActive = wrap(async (req, res) => {
  res.json(await groupService.listActive());
});

/** 查詢同店家、仍在收單中的同名團，讓前端在開團前提醒 */
export const listDuplicates = wrap(async (req, res) => {
  const { storeId, title } = req.query;
  if (!storeId || !title) throw badRequest('需要 storeId 與 title');

  const id = parseIntId(storeId);
  if (id === null) throw badRequest('storeId 必須是數字');

  res.json(await groupService.findOpenDuplicates(id, title));
});

export const get = wrap(async (req, res) => {
  res.json(await groupService.getSnapshot(req.params.joinCode, readCredentials(req)));
});

export const verifyManageCode = wrap(async (req, res) => {
  const input = parse(manageCodeSchema, req.body);
  res.json(await groupService.verifyManageCode(req.params.joinCode, input));
});

export const update = wrap(async (req, res) => {
  const input = parse(patchGroupSchema, req.body);
  res.json(await groupService.updateGroup(req.params.joinCode, input, readCredentials(req)));
});

export const bulkUpdateItemStatus = wrap(async (req, res) => {
  const input = parse(bulkStatusSchema, req.body);
  res.json(
    await groupService.bulkUpdateItemStatus(req.params.joinCode, input, readCredentials(req)),
  );
});

export const remove = wrap(async (req, res) => {
  await groupService.deleteGroup(req.params.joinCode, readCredentials(req));
  res.status(204).end();
});
