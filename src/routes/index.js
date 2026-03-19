'use strict';

const express = require('express');
const router = express.Router();

const { authMiddleware } = require('../middleware/auth');

// Handlers
const authHandler = require('../handlers/authHandler');
const userHandler = require('../handlers/userHandler');
const chatHandler = require('../handlers/chatHandler');
const messageHandler = require('../handlers/messageHandler');
const callHandler = require('../handlers/callHandler');
const { upload, uploadFile, serveFile } = require('../handlers/fileHandler');
const contactHandler = require('../handlers/contactHandler');
const proposalHandler = require('../handlers/proposalHandler');
const typingHandler = require('../handlers/typingHandler');
const groupHandler = require('../handlers/groupHandler');
const channelHandler = require('../handlers/channelHandler');
const notificationHandler = require('../handlers/notificationHandler');
const storyHandler = require('../handlers/storyHandler');
const likeHandler = require('../handlers/likeHandler');
const profileCommentHandler = require('../handlers/profileCommentHandler');
const companyHandler = require('../handlers/companyHandler');
const productHandler = require('../handlers/productHandler');
const commentHandler = require('../handlers/commentHandler');
const settingsHandler = require('../handlers/settingsHandler');

// ─── Health check ─────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── File serving (public — no auth needed for images/files in chat) ──────────
router.get('/files/:filename', serveFile);

// ─── Auth routes ──────────────────────────────────────────────────────────────
router.post('/auth/register', authHandler.register);
router.post('/auth/login', authHandler.login);
router.get('/auth/qr/:user_id', authHandler.getQRCode);
router.post('/auth/verify-phone', authHandler.verifyPhone);
router.post('/auth/send-code', authHandler.sendCode);
router.post('/auth/verify-code', authHandler.verifyCode);
router.post('/auth/register-with-code', authHandler.registerWithCode);

// ─── Public routes (no auth) ──────────────────────────────────────────────────
router.get('/public/users/search', userHandler.searchByUsername);
router.post('/public/profile-comments', profileCommentHandler.createProfileCommentByPhone);
router.get('/public/profile-comments/search', profileCommentHandler.searchProfileComments);

// ─── All routes below require authentication ──────────────────────────────────
router.use(authMiddleware);

// ── User routes ────────────────────────────────────────────────────────────────
router.get('/users/me', userHandler.getMe);
router.get('/users/profile/:id', userHandler.getUserByID);
router.get('/users/by-phone', userHandler.getUserByPhoneNumber);
router.put('/users/me', userHandler.updateMe);
router.put('/users/location', userHandler.updateLocation);
router.get('/users/nearby', userHandler.getNearbyUsers);
router.get('/users/search', userHandler.searchByUsername);
router.get('/users/devices', userHandler.getDevices);
router.get('/users/online/:id', userHandler.checkOnlineStatus);
router.get('/users/online', userHandler.getOnlineUsers);

// ── Contact routes ─────────────────────────────────────────────────────────────
router.get('/contacts', contactHandler.getContacts);
router.post('/contacts', contactHandler.addContact);
router.post('/contacts/scan', contactHandler.scanQRCode);
router.delete('/contacts/:contact_id', contactHandler.deleteContact);

// ── Profile comment routes (protected) ────────────────────────────────────────
router.post('/profile-comments', profileCommentHandler.createProfileComment);
router.get('/profile-comments', profileCommentHandler.getProfileComments);
router.get('/profile-comments/search', profileCommentHandler.searchProfileComments);
router.post('/profile-comments/:comment_id/reply', profileCommentHandler.replyToProfileComment);
router.delete('/profile-comments/:comment_id', profileCommentHandler.deleteProfileComment);

// Profile comment reactions
router.post('/profile-comments/:comment_id/like', likeHandler.likeProfileComment);
router.delete('/profile-comments/:comment_id/like', likeHandler.unlikeProfileComment);
router.post('/profile-comments/:comment_id/dislike', likeHandler.dislikeProfileComment);
router.delete('/profile-comments/:comment_id/dislike', likeHandler.undislikeProfileComment);

// ── Chat routes ────────────────────────────────────────────────────────────────
router.get('/chats', chatHandler.getChats);
router.post('/chats', chatHandler.createChat);
router.get('/chats/:chat_id', chatHandler.getChat);
router.get('/chats/:chat_id/messages', chatHandler.getMessages);
router.post('/chats/:chat_id/messages', chatHandler.sendMessage);
router.delete('/chats/:chat_id', chatHandler.deleteChat);

// ── Message routes ─────────────────────────────────────────────────────────────
router.put('/messages/:message_id', messageHandler.editMessage);
router.delete('/messages/:message_id', messageHandler.deleteMessage);
router.post('/messages/:message_id/forward', messageHandler.forwardMessage);
router.post('/messages/:message_id/reaction', messageHandler.addReaction);
router.delete('/messages/:message_id/reaction', messageHandler.removeReaction);
router.post('/messages/read', messageHandler.markAsRead);
router.post('/messages/:message_id/pin', messageHandler.pinMessage);
router.delete('/messages/:message_id/pin', messageHandler.unpinMessage);
router.post('/messages/:message_id/poll/vote', messageHandler.votePoll);
router.get('/messages/search', messageHandler.searchMessages);
router.get('/messages/:message_id/translate', messageHandler.translateMessage);

// ── Typing routes ──────────────────────────────────────────────────────────────
router.post('/typing/:chat_id', typingHandler.setTyping);
router.get('/typing/:chat_id', typingHandler.getTyping);

// ── Group routes ───────────────────────────────────────────────────────────────
router.post('/groups', groupHandler.createGroup);
router.get('/groups', groupHandler.getGroups);
router.get('/groups/:group_id', groupHandler.getGroup);
router.put('/groups/:group_id', groupHandler.updateGroup);
router.delete('/groups/:group_id', groupHandler.deleteGroup);
router.post('/groups/:group_id/members', groupHandler.addMember);
router.delete('/groups/:group_id/members/:member_id', groupHandler.removeMember);
router.get('/groups/:group_id/statistics', groupHandler.getStatistics);

// ── Channel routes ─────────────────────────────────────────────────────────────
router.post('/channels', channelHandler.createChannel);
router.post('/channels/:channel_id/subscribe', channelHandler.subscribe);
router.post('/channels/:channel_id/unsubscribe', channelHandler.unsubscribe);
router.post('/channels/:channel_id/messages/:message_id/view', channelHandler.recordView);
router.get('/channels/:channel_id/statistics', channelHandler.getStatistics);

// ── Call routes ────────────────────────────────────────────────────────────────
router.post('/calls', callHandler.initiateCall);
router.post('/calls/:call_id/answer', callHandler.answerCall);
router.post('/calls/:call_id/end', callHandler.endCall);

// ── Proposal routes ────────────────────────────────────────────────────────────
router.post('/proposals', proposalHandler.createProposal);
router.get('/proposals', proposalHandler.getProposals);
router.put('/proposals/:proposal_id/accept', proposalHandler.acceptProposal);
router.put('/proposals/:proposal_id/reject', proposalHandler.rejectProposal);
router.delete('/proposals/:proposal_id', proposalHandler.deleteProposal);

// ── File upload ────────────────────────────────────────────────────────────────
router.post('/files/upload', upload.single('file'), uploadFile);

// ── Settings routes ────────────────────────────────────────────────────────────
router.get('/settings', settingsHandler.getSettings);
router.put('/settings', settingsHandler.updateSettings);
router.put('/settings/account', settingsHandler.updateAccountSettings);
router.put('/settings/privacy', settingsHandler.updatePrivacySettings);
router.put('/settings/chat', settingsHandler.updateChatSettings);
router.put('/settings/notifications', settingsHandler.updateNotificationSettings);
router.put('/settings/appearance', settingsHandler.updateAppearanceSettings);
router.put('/settings/data', settingsHandler.updateDataSettings);
router.put('/settings/calls', settingsHandler.updateCallSettings);
router.put('/settings/groups', settingsHandler.updateGroupSettings);
router.put('/settings/advanced', settingsHandler.updateAdvancedSettings);
router.get('/settings/sessions', settingsHandler.getSessions);
router.delete('/settings/sessions/:session_id', settingsHandler.terminateSession);
router.post('/settings/block', settingsHandler.blockUser);
router.delete('/settings/block/:user_id', settingsHandler.unblockUser);
router.get('/settings/blocked', settingsHandler.getBlockedUsers);
router.post('/settings/suspend', settingsHandler.suspendAccount);
router.post('/settings/delete', settingsHandler.deleteAccount);
router.post('/settings/cache/clear', settingsHandler.clearCache);
router.get('/settings/data-usage', settingsHandler.getDataUsage);

// ── Company routes ─────────────────────────────────────────────────────────────
router.post('/companies', companyHandler.createCompany);
router.get('/companies/me', companyHandler.getMyCompanies);
router.get('/companies/user/:user_id', companyHandler.getUserCompanies);
router.put('/companies/:company_id', companyHandler.updateCompany);
router.delete('/companies/:company_id', companyHandler.deleteCompany);
router.get('/companies/categories', companyHandler.getCategories);

// ── Product routes ─────────────────────────────────────────────────────────────
router.post('/products', productHandler.createProduct);
router.get('/products', productHandler.getProducts);
router.get('/products/:product_id', productHandler.getProduct);
router.put('/products/:product_id', productHandler.updateProduct);
router.delete('/products/:product_id', productHandler.deleteProduct);
router.get('/products/user/:user_id', productHandler.getUserProducts);

// ── Comment routes ─────────────────────────────────────────────────────────────
router.post('/products/:product_id/comments', commentHandler.createComment);
router.get('/products/:product_id/comments', commentHandler.getComments);
router.delete('/comments/:comment_id', commentHandler.deleteComment);
router.post('/comments/:comment_id/report', commentHandler.reportSpam);

// ── Like routes ────────────────────────────────────────────────────────────────
router.post('/products/:product_id/like', likeHandler.likeProduct);
router.delete('/products/:product_id/like', likeHandler.unlikeProduct);
router.post('/comments/:comment_id/like', likeHandler.likeComment);
router.delete('/comments/:comment_id/like', likeHandler.unlikeComment);
router.post('/comments/:comment_id/dislike', likeHandler.dislikeComment);
router.delete('/comments/:comment_id/dislike', likeHandler.undislikeComment);
router.get('/products/:product_id/likes', likeHandler.getProductLikes);

// ── Notification routes ────────────────────────────────────────────────────────
router.get('/notifications', notificationHandler.getNotifications);
router.post('/notifications/read', notificationHandler.markNotificationsRead);
router.get('/notifications/unread-count', notificationHandler.getUnreadCount);

// ── Story routes ───────────────────────────────────────────────────────────────
router.post('/stories', storyHandler.createStory);
router.get('/stories', storyHandler.getStoryFeed);
router.get('/stories/user/:user_id', storyHandler.getUserStories);
router.delete('/stories/:story_id', storyHandler.deleteStory);
router.post('/stories/:story_id/like', storyHandler.likeStory);
router.delete('/stories/:story_id/like', storyHandler.unlikeStory);
router.post('/stories/:story_id/dislike', storyHandler.dislikeStory);
router.delete('/stories/:story_id/dislike', storyHandler.undislikeStory);
router.post('/stories/:story_id/comments', storyHandler.addStoryComment);
router.get('/stories/:story_id/comments', storyHandler.getStoryComments);

module.exports = router;
