// Global variables
let currentUser = null;
let currentConversation = null;
let websocket = null;
let notificationSocket = null;
let notificationSocketConnected = false;
let selectedMembers = [];
let typingTimeout = null;
let itMaintainUsers = [];
let itMembershipHistory = [];
let activeClickedImg = null;
let imageViewerDragHandlers = null;

function isElectronApp() {
    return !!(window.electronAPI && window.electronAPI.isElectron) ||
        (typeof navigator === 'object' && navigator.userAgent.includes('Electron'));
}

function isCurrentUserItMember() {
    const itUsernames = ['s20330', '250479', '230022', '140287', '111075', 'ithelpdesk'];
    return !!(currentUser && (currentUser.is_it_member || itUsernames.includes(currentUser.username)));
}
let currentHelpDeskContainers = [];
let currentIsItMember = false;
let currentHelpDeskFilter = 'pending';
let helpdeskFromDate = null;
let helpdeskToDate = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    requestNotificationPermission();
});

// Check authentication
function checkAuth() {
    const user = localStorage.getItem('user');
    if (user) {
        currentUser = JSON.parse(user);
        updateUserProfile();
        refreshCurrentUserProfile();
        loadConversations();
        connectNotificationSocket();
    } else {
        window.location.href = '/login/';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Load conversation open times from localStorage
    loadConversationOpenTimes();

    const userMenuBtn = document.getElementById('userMenuBtn');
    if (userMenuBtn) {
        userMenuBtn.addEventListener('click', toggleUserMenu);
    }

    const changePasswordBtn = document.getElementById('changePasswordBtn');
    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', () => {
            closeUserMenu();
            showChangePasswordModal();
        });
    }

    const itMaintainUsersBtn = document.getElementById('itMaintainUsersBtn');
    if (itMaintainUsersBtn) {
        itMaintainUsersBtn.addEventListener('click', () => {
            closeUserMenu();
            openItMaintainUsersWorkspace();
        });
    }

    const itReportsBtn = document.getElementById('itReportsBtn');
    if (itReportsBtn) {
        itReportsBtn.addEventListener('click', () => {
            closeUserMenu();
            openItReportsWorkspace();
        });
    }

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            closeUserMenu();
            logout();
        });
    }

    // New group - only for IT members
    console.log('Current user:', currentUser);
    console.log('Is IT member:', isCurrentUserItMember());

    updateUserMenuVisibility();
    const newGroupBtn = document.getElementById('newGroupBtn');
    if (newGroupBtn) {
        newGroupBtn.addEventListener('click', () => {
            closeUserMenu();
            openModal('newGroupModal');
            loadUsersForGroup();
        });
    }

    // Search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(handleSearch, 300));
    }

    const searchInChatBtn = document.getElementById('searchInChatBtn');
    const inChatSearch = document.getElementById('inChatSearch');
    const inChatSearchInput = document.getElementById('inChatSearchInput');

    if (searchInChatBtn) {
        searchInChatBtn.addEventListener('click', () => {
            if (inChatSearch.style.display === 'none') {
                inChatSearch.style.display = 'block';
                inChatSearchInput.focus();
            } else {
                inChatSearch.style.display = 'none';
                inChatSearchInput.value = '';
                handleInChatSearch(); // Reset filter
            }
        });
    }

    if (inChatSearchInput) {
        inChatSearchInput.addEventListener('input', debounce(handleInChatSearch, 300));
    }

    // Message input
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        messageInput.addEventListener('input', handleTyping);
    }

    // Send button
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    // Emoji button
    const emojiBtn = document.getElementById('emojiBtn');
    console.log('Emoji button element:', emojiBtn);
    if (emojiBtn) {
        emojiBtn.addEventListener('click', (e) => {
            console.log('Emoji button clicked');
            e.preventDefault();
            e.stopPropagation();
            toggleEmojiPicker();
        });
    } else {
        console.error('Emoji button not found');
    }

    // Attach file
    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('fileInput');

    if (attachBtn) {
        attachBtn.addEventListener('click', () => {
            if (fileInput) fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', handleFileUpload);
    }

    // Group member search
    const groupMemberSearch = document.getElementById('groupMemberSearch');
    if (groupMemberSearch) {
        groupMemberSearch.addEventListener('input', debounce(() => loadUsersForGroup(), 300));
    }

    // Create group
    const createGroupBtn = document.getElementById('createGroupBtn');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', createGroup);
    }

    // Context menu
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('click', closeUserMenuOnOutsideClick);

    // Notification toast
    const toastClose = document.getElementById('toastClose');
    if (toastClose) {
        toastClose.addEventListener('click', hideNotificationToast);
    }

    // New group modal
    const closeNewGroupModal = document.getElementById('closeNewGroupModal');
    if (closeNewGroupModal) {
        closeNewGroupModal.addEventListener('click', () => closeModal('newGroupModal'));
    }

    const itMaintainUserSearch = document.getElementById('itMaintainUserSearch');
    if (itMaintainUserSearch) {
        itMaintainUserSearch.addEventListener('input', renderItMaintainUsers);
    }

    const itMaintainHistorySearch = document.getElementById('itMaintainHistorySearch');
    if (itMaintainHistorySearch) {
        itMaintainHistorySearch.addEventListener('input', renderItMembershipHistory);
    }

    const itMaintainUsersViewBtn = document.getElementById('itMaintainUsersViewBtn');
    if (itMaintainUsersViewBtn) {
        itMaintainUsersViewBtn.addEventListener('click', showItMaintainUsersView);
    }

    const itMaintainHistoryBtn = document.getElementById('itMaintainHistoryBtn');
    if (itMaintainHistoryBtn) {
        itMaintainHistoryBtn.addEventListener('click', showItMaintainHistoryView);
    }

    // Add members modal
    const closeAddMembersModal = document.getElementById('closeAddMembersModal');
    if (closeAddMembersModal) {
        closeAddMembersModal.addEventListener('click', () => closeModal('addMembersModal'));
    }

    // File viewer modal
    const closeFileViewerModal = document.getElementById('closeFileViewerModal');
    if (closeFileViewerModal) {
        closeFileViewerModal.addEventListener('click', () => closeFileViewer());
    }

    const closeGroupInfoModal = document.getElementById('closeGroupInfoModal');
    if (closeGroupInfoModal) {
        closeGroupInfoModal.addEventListener('click', () => closeModal('groupInfoModal'));
    }

    const closeBroadcastModal = document.getElementById('closeBroadcastModal');
    if (closeBroadcastModal) {
        closeBroadcastModal.addEventListener('click', () => closeModal('broadcastModal'));
    }

    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (modal.id === 'fileViewerModal') {
                    closeFileViewer();
                } else {
                    closeModal(modal.id);
                }
            }
        });
    });

    // Open attachments consistently across chats, help desk, and other screens
    document.addEventListener('click', (e) => {
        const mediaFile = e.target.closest('.media-file');
        if (!mediaFile || !mediaFile.dataset.fileUrl) return;

        e.preventDefault();
        e.stopPropagation();

        activeClickedImg = mediaFile.tagName === 'IMG'
            ? mediaFile
            : (mediaFile.querySelector('img, video') || mediaFile);

        openFile(mediaFile.dataset.fileUrl, mediaFile.dataset.fileName, mediaFile.dataset.messageType);
    });

    // Chat menu
    const chatMenuBtn = document.getElementById('chatMenuBtn');
    if (chatMenuBtn) {
        chatMenuBtn.addEventListener('click', toggleChatMenu);
    }

    const clearChatBtn = document.getElementById('clearChatBtn');
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', clearChat);
    }

    const selectMessagesBtn = document.getElementById('selectMessagesBtn');
    if (selectMessagesBtn) {
        selectMessagesBtn.addEventListener('click', enterSelectionMode);
    }

    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener('click', deleteSelectedMessages);
    }

    const cancelSelectionBtn = document.getElementById('cancelSelectionBtn');
    if (cancelSelectionBtn) {
        cancelSelectionBtn.addEventListener('click', exitSelectionMode);
    }

    // Message selection in selection mode
    document.getElementById('messagesContainer').addEventListener('click', (e) => {
        if (!isSelectionMode) return;

        const messageEl = e.target.closest('.message');
        if (messageEl) {
            const messageId = messageEl.dataset.messageId;
            if (messageId) {
                toggleMessageSelection(messageId);
            }
        }
    });

    // Emoji picker functionality
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('emoji')) {
            const emoji = e.target.textContent;
            const messageInput = document.getElementById('messageInput');
            if (messageInput) {
                messageInput.value += emoji;
                messageInput.focus();
            }
        }
    });

    // Close emoji picker if clicking outside
    document.addEventListener('click', (e) => {
        const picker = document.getElementById('emojiPicker');
        const emojiBtn = document.getElementById('emojiBtn');
        if (!picker.contains(e.target) && e.target !== emojiBtn) {
            picker.style.display = 'none';
        }
    });

    // Notification system event listeners
    document.getElementById('notificationConfirm').addEventListener('click', () => {
        const overlay = document.getElementById('notificationOverlay');
        if (overlay.onConfirm) {
            overlay.onConfirm();
        }
        hideNotification();
    });

    document.getElementById('notificationCancel').addEventListener('click', () => {
        const overlay = document.getElementById('notificationOverlay');
        if (overlay.onCancel) {
            overlay.onCancel();
        }
        hideNotification();
    });

    // Close notification on overlay click
    document.getElementById('notificationOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            hideNotification();
        }
    });
}

async function refreshCurrentUserProfile() {
    try {
        const response = await fetch('/api/auth/profile/');
        if (!response.ok) return;
        const profile = await response.json();
        currentUser = {
            ...currentUser,
            ...profile
        };
        localStorage.setItem('user', JSON.stringify(currentUser));
        updateUserProfile();
        updateUserMenuVisibility();
    } catch (error) {
        console.debug('Unable to refresh current user profile', error);
    }
}

function updateUserMenuVisibility() {
    const isItMember = isCurrentUserItMember();
    document.querySelectorAll('.it-menu-item').forEach(item => {
        item.style.display = isItMember ? 'flex' : 'none';
    });

    const newGroupBtn = document.getElementById('newGroupBtn');
    if (newGroupBtn) {
        newGroupBtn.style.display = isItMember ? 'flex' : 'none';
    }
}

function toggleUserMenu(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const dropdown = document.getElementById('userMenuDropdown');
    const button = document.getElementById('userMenuBtn');
    if (!dropdown || !button) return;

    const isOpen = dropdown.style.display === 'block';
    dropdown.style.display = isOpen ? 'none' : 'block';
    button.setAttribute('aria-expanded', String(!isOpen));
}

function closeUserMenu() {
    const dropdown = document.getElementById('userMenuDropdown');
    const button = document.getElementById('userMenuBtn');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    if (button) {
        button.setAttribute('aria-expanded', 'false');
    }
}

function closeUserMenuOnOutsideClick(event) {
    const menu = document.getElementById('userMenu');
    if (!menu || menu.contains(event.target)) {
        return;
    }

    closeUserMenu();
}

function showWorkspaceView(title, subtitle) {
    const placeholder = document.getElementById('chatPlaceholder');
    const chatContainer = document.getElementById('chatContainer');
    const workspaceView = document.getElementById('workspaceView');
    const workspaceTitle = document.getElementById('workspaceTitle');
    const workspaceSubtitle = document.getElementById('workspaceSubtitle');

    if (placeholder) placeholder.style.display = 'none';
    if (chatContainer) chatContainer.style.display = 'none';
    if (workspaceView) workspaceView.style.display = 'flex';
    if (workspaceTitle) workspaceTitle.textContent = title;
    if (workspaceSubtitle) workspaceSubtitle.textContent = subtitle;

    document.querySelectorAll('.conversation-item').forEach(item => item.classList.remove('active'));
}

function hideWorkspaceView() {
    const workspaceView = document.getElementById('workspaceView');
    const itReportsFrame = document.getElementById('itReportsFrame');
    const itMaintainUsersPage = document.getElementById('itMaintainUsersPage');

    if (workspaceView) workspaceView.style.display = 'none';
    if (itReportsFrame) itReportsFrame.style.display = 'none';
    if (itMaintainUsersPage) itMaintainUsersPage.style.display = 'none';
}

function openItReportsWorkspace() {
    showWorkspaceView('IT Reports', 'Reports are open here while your chats remain available in the sidebar.');
    const itReportsFrame = document.getElementById('itReportsFrame');
    const itMaintainUsersPage = document.getElementById('itMaintainUsersPage');
    if (itMaintainUsersPage) itMaintainUsersPage.style.display = 'none';
    if (itReportsFrame) {
        itReportsFrame.style.display = 'block';
        if (!itReportsFrame.src) {
            itReportsFrame.src = '/it-reports/';
        }
    }
}

async function openItMaintainUsersWorkspace() {
    showWorkspaceView('IT maintain users', 'Promote or remove IT access without leaving the chat workspace.');
    const itReportsFrame = document.getElementById('itReportsFrame');
    const itMaintainUsersPage = document.getElementById('itMaintainUsersPage');
    if (itReportsFrame) itReportsFrame.style.display = 'none';
    if (itMaintainUsersPage) itMaintainUsersPage.style.display = 'block';
    showItMaintainUsersView();
    await loadItMaintainUsers();
}

async function loadItMaintainUsers() {
    const list = document.getElementById('itMaintainUsersList');
    if (list) {
        list.innerHTML = '<div class="it-maintain-user-row">Loading users...</div>';
    }

    try {
        const response = await fetch('/api/messaging/it-membership/users/');
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Unable to load users');
        }

        itMaintainUsers = data.users || [];
        renderItMaintainUsers();
    } catch (error) {
        if (list) {
            list.innerHTML = `<div class="it-maintain-user-row">${escapeHtml(error.message)}</div>`;
        }
    }
}

function renderItMaintainUsers() {
    const list = document.getElementById('itMaintainUsersList');
    const searchInput = document.getElementById('itMaintainUserSearch');
    if (!list) return;

    const query = ((searchInput && searchInput.value) || '').trim().toLowerCase();
    const filteredUsers = itMaintainUsers.filter(user => {
        const text = `${user.username || ''} ${user.full_name || ''} ${user.display_name || ''}`.toLowerCase();
        return !query || text.includes(query);
    });

    if (filteredUsers.length === 0) {
        list.innerHTML = '<div class="it-maintain-user-row">No users found.</div>';
        return;
    }

    list.innerHTML = filteredUsers.map(user => {
        const isProtected = !!user.is_protected;
        const isItMember = !!user.is_it_member;
        const actionLabel = isItMember ? 'Remove IT' : 'Make IT';
        const disabled = isProtected ? 'disabled' : '';
        const roleText = isProtected ? 'Built-in IT member' : (isItMember ? 'IT member' : 'Normal user');
        return `
            <div class="it-maintain-user-row">
                <div class="it-maintain-user-info">
                    <div class="it-maintain-user-name">${escapeHtml(user.display_name || user.username)}</div>
                    <div class="it-maintain-user-role">${escapeHtml(roleText)}</div>
                </div>
                <button type="button"
                    class="it-maintain-user-action ${isItMember ? 'remove' : ''}"
                    onclick="updateItMembership(${user.id}, ${!isItMember})"
                    ${disabled}>
                    ${escapeHtml(actionLabel)}
                </button>
            </div>
        `;
    }).join('');
}

function showItMaintainUsersView() {
    const usersList = document.getElementById('itMaintainUsersList');
    const historyList = document.getElementById('itMaintainHistoryList');
    const searchInput = document.getElementById('itMaintainUserSearch');
    const historySearchGroup = document.getElementById('itMaintainHistorySearchGroup');
    if (usersList) usersList.style.display = 'flex';
    if (historyList) historyList.style.display = 'none';
    if (searchInput) searchInput.parentElement.style.display = 'block';
    if (historySearchGroup) historySearchGroup.style.display = 'none';
}

async function showItMaintainHistoryView() {
    const usersList = document.getElementById('itMaintainUsersList');
    const historyList = document.getElementById('itMaintainHistoryList');
    const searchInput = document.getElementById('itMaintainUserSearch');
    const historySearchGroup = document.getElementById('itMaintainHistorySearchGroup');
    if (usersList) usersList.style.display = 'none';
    if (historyList) {
        historyList.style.display = 'flex';
        historyList.innerHTML = '<div class="it-maintain-history-row">Loading history...</div>';
    }
    if (searchInput) searchInput.parentElement.style.display = 'none';
    if (historySearchGroup) historySearchGroup.style.display = 'block';
    await loadItMembershipHistory();
}

async function loadItMembershipHistory() {
    const historyList = document.getElementById('itMaintainHistoryList');
    try {
        const response = await fetch('/api/messaging/it-membership/history/');
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Unable to load history');
        }

        itMembershipHistory = data.history || [];
        renderItMembershipHistory();
    } catch (error) {
        if (historyList) {
            historyList.innerHTML = `<div class="it-maintain-history-row">${escapeHtml(error.message)}</div>`;
        }
    }
}

function renderItMembershipHistory() {
    const historyList = document.getElementById('itMaintainHistoryList');
    const historySearch = document.getElementById('itMaintainHistorySearch');
    if (!historyList) return;

    const query = ((historySearch && historySearch.value) || '').trim().toLowerCase();
    const filteredHistory = itMembershipHistory.filter(item => {
        const changedAt = item.created_at ? new Date(item.created_at).toLocaleString() : '';
        const searchableText = [
            item.id,
            item.target_user_id,
            item.target_username,
            item.target_full_name,
            item.from_role,
            item.to_role,
            item.changed_by_user_id,
            item.changed_by_username,
            item.changed_by_full_name,
            changedAt
        ].join(' ').toLowerCase();
        return !query || searchableText.includes(query);
    });

    if (filteredHistory.length === 0) {
        historyList.innerHTML = '<div class="it-maintain-history-row">No role changes yet.</div>';
        return;
    }

    const rows = filteredHistory.map(item => {
        const changedByName = item.changed_by_full_name || item.changed_by_username;
        const targetName = item.target_full_name || item.target_username;
        const changedAt = item.created_at ? new Date(item.created_at).toLocaleString() : '';
        return `
            <tr>
                <td>${escapeHtml(String(item.id || ''))}</td>
                <td>${escapeHtml(String(item.target_user_id || ''))}</td>
                <td>${escapeHtml(item.target_username || '')}</td>
                <td>${escapeHtml(targetName || '')}</td>
                <td>${escapeHtml(item.from_role || '')}</td>
                <td>${escapeHtml(item.to_role || '')}</td>
                <td>${escapeHtml(String(item.changed_by_user_id || ''))}</td>
                <td>${escapeHtml(item.changed_by_username || '')}</td>
                <td>${escapeHtml(changedByName || '')}</td>
                <td>${escapeHtml(changedAt)}</td>
            </tr>
        `;
    }).join('');

    historyList.innerHTML = `
        <div class="it-maintain-history-table-wrap">
            <table class="it-maintain-history-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>User ID</th>
                        <th>Username</th>
                        <th>Name</th>
                        <th>From Stage</th>
                        <th>To Stage</th>
                        <th>Changed By ID</th>
                        <th>Changed By Username</th>
                        <th>Changed By Name</th>
                        <th>Changed At</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

async function updateItMembership(userId, isItMember) {
    const user = itMaintainUsers.find(item => item.id === userId);
    const userLabel = user ? (user.display_name || user.username) : 'this user';
    const nextRole = isItMember ? 'IT member' : 'normal user';
    const confirmed = confirm(`Are you sure you want to change ${userLabel} to ${nextRole}?`);
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch('/api/messaging/it-membership/update/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({
                user_id: userId,
                is_it_member: isItMember
            })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Unable to update user');
        }

        const index = itMaintainUsers.findIndex(user => user.id === data.user.id);
        if (index !== -1) {
            itMaintainUsers[index] = {
                ...itMaintainUsers[index],
                ...data.user
            };
        }
        renderItMaintainUsers();
        itMembershipHistory = [];
        showToast(isItMember ? 'User is now an IT member' : 'User is now a normal user', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Beautiful Notification System
function showNotification(options) {
    const overlay = document.getElementById('notificationOverlay');
    const icon = document.getElementById('notificationIcon');
    const title = document.getElementById('notificationTitle');
    const message = document.getElementById('notificationMessage');
    const confirmBtn = document.getElementById('notificationConfirm');
    const cancelBtn = document.getElementById('notificationCancel');

    // Set content
    title.textContent = options.title || 'Notification';
    message.textContent = options.message || '';

    // Set icon type
    icon.className = 'notification-icon';
    if (options.type === 'error') {
        icon.classList.add('error');
        icon.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
    } else if (options.type === 'warning') {
        icon.classList.add('warning');
        icon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
    } else if (options.type === 'success') {
        icon.innerHTML = '<i class="fas fa-check-circle"></i>';
    } else {
        icon.innerHTML = '<i class="fas fa-info-circle"></i>';
    }

    // Set buttons
    confirmBtn.textContent = options.confirmText || 'OK';
    if (options.showCancel) {
        cancelBtn.style.display = 'block';
        cancelBtn.textContent = options.cancelText || 'Cancel';
    } else {
        cancelBtn.style.display = 'none';
    }

    // Store callbacks
    overlay.onConfirm = options.onConfirm || null;
    overlay.onCancel = options.onCancel || null;

    // Show notification
    overlay.style.display = 'flex';
}

function hideNotification() {
    const overlay = document.getElementById('notificationOverlay');
    overlay.style.display = 'none';
}

// Confirmation dialog helper
function showConfirmDialog(title, message, onConfirm) {
    showNotification({
        title: title,
        message: message,
        type: 'info',
        showCancel: true,
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        onConfirm: onConfirm
    });
}

// Toast notification system for small messages
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';

    // Set icon and color based on type
    let icon = 'fas fa-info-circle';
    let bgColor = '#202c33';
    let textColor = '#e9edef';

    switch (type) {
        case 'success':
            icon = 'fas fa-check-circle';
            bgColor = '#00a884';
            break;
        case 'error':
            icon = 'fas fa-exclamation-circle';
            bgColor = '#ef4444';
            break;
        case 'warning':
            icon = 'fas fa-exclamation-triangle';
            bgColor = '#f59e0b';
            break;
    }

    toast.innerHTML = `
        <div class="toast-content">
            <i class="${icon}"></i>
            <span>${message}</span>
        </div>
    `;

    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${bgColor};
        color: ${textColor};
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 200px;
        max-width: 300px;
        animation: slideInRight 0.3s ease;
        font-size: 14px;
    `;

    document.body.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// Add CSS animations for toast
const toastStyles = document.createElement('style');
toastStyles.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .toast-content {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .toast-content i {
        font-size: 16px;
    }
`;
document.head.appendChild(toastStyles);

// Send message
async function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const content = messageInput.value.trim();

    if (!content) {
        return;
    }

    if (!currentConversation) {
        showToast('Please select a conversation first', 'error');
        return;
    }

    try {
        const messageData = {
            conversation_id: currentConversation.id,
            content: content,
            message_type: 'text'
        };

        // Add reply_to if replying to a message
        const replyToId = messageInput.dataset.replyTo;
        if (replyToId) {
            messageData.reply_to = parseInt(replyToId);
        }

        const response = await fetch('/api/messaging/messages/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify(messageData)
        });

        if (response.ok) {
            messageInput.value = '';
            messageInput.dataset.replyTo = ''; // Clear reply target
            clearReplyPreview(); // Clear reply preview UI
            // Keep focus on message input after sending
            messageInput.focus();
            // Reload messages and conversations
            loadMessages(currentConversation.id);
            loadConversations();
            // Ensure chat container stays visible
            document.getElementById('chatContainer').style.display = 'flex';
            document.getElementById('chatPlaceholder').style.display = 'none';
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to send message', 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showToast('Failed to send message', 'error');
    }
}

// Get cookie by name (for CSRF token)
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// Update user profile in sidebar
function updateUserProfile() {
    document.getElementById('userName').textContent = currentUser.full_name || currentUser.username;
    document.getElementById('userStatus').textContent = '';
    // Remove profile picture
    const profilePic = document.getElementById('profilePic');
    if (profilePic) {
        profilePic.style.display = 'none';
    }
}

// Load conversations
async function loadConversations() {
    try {
        const response = await fetch('/api/messaging/conversations/');
        const data = await response.json();

        const conversationsList = document.getElementById('conversationsList');
        conversationsList.innerHTML = '';

        data.conversations.forEach(conv => {
            // Skip conversations with invalid data or superusers
            if (!conv || !conv.name || conv.name === 'undefined' || conv.name === 'null') {
                return;
            }

            // Skip if conversation has superuser participants
            if (conv.participants && conv.participants.some(p => p.is_superuser)) {
                return;
            }

            // Calculate new message count based on last open time
            const lastOpenTime = conversationOpenTimes.get(conv.id);
            let newMessageCount = 0;

            console.log(`Conversation ${conv.id}: lastOpenTime = ${lastOpenTime}, last_message = ${conv.last_message ? conv.last_message.created_at : 'none'}`);

            if (lastOpenTime && conv.last_message) {
                const lastMessageTime = new Date(conv.last_message.created_at);
                const lastOpenDate = new Date(lastOpenTime);
                console.log(`Comparing: lastMessageTime (${lastMessageTime}) > lastOpenDate (${lastOpenDate}) = ${lastMessageTime > lastOpenDate}`);
                if (lastMessageTime > lastOpenDate && conv.last_message.sender_id !== currentUser.id) {
                    // Count messages since last open time (simplified - just show 1 for now)
                    newMessageCount = 1;
                    console.log(`Setting new message count to 1 for conversation ${conv.id}`);
                }
            } else if (!lastOpenTime && conv.unread_count > 0) {
                // First time opening, use backend unread count
                newMessageCount = conv.unread_count;
                console.log(`First time opening conversation ${conv.id}, using unread count: ${conv.unread_count}`);
            } else {
                console.log(`No new messages for conversation ${conv.id}`);
            }

            // Add new message count to conversation data
            conv.new_message_count = newMessageCount;
            console.log(`Final new message count for conversation ${conv.id}: ${newMessageCount}`);

            const convElement = createConversationElement(conv);
            conversationsList.appendChild(convElement);
        });
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

// Create conversation element
function createConversationElement(conv) {
    const div = document.createElement('div');
    div.className = 'conversation-item';
    div.dataset.conversationId = conv.id;

    div.innerHTML = `
        <div class="conversation-info">
            <div class="conversation-name">${conv.name || (conv.username ? conv.username : 'Unknown')}</div>
            <div class="conversation-preview">${conv.last_message ? conv.last_message.content : 'No messages yet'}</div>
        </div>
        <div class="conversation-meta">
            <span class="conversation-time">${conv.last_message ? formatTime(conv.last_message.created_at) : ''}</span>
            ${conv.new_message_count > 0 ? `<span class="unread-badge">${conv.new_message_count}</span>` : ''}
        </div>
    `;

    div.addEventListener('click', () => openConversation(conv.id));

    return div;
}

// Store when conversations were last opened (persisted in localStorage)
const conversationOpenTimes = new Map();

// Load conversation open times from localStorage on page load
function loadConversationOpenTimes() {
    console.log('Loading conversation open times from localStorage...');
    const stored = localStorage.getItem('conversationOpenTimes');
    console.log('Stored data:', stored);

    if (stored) {
        try {
            const data = JSON.parse(stored);
            console.log('Parsed data:', data);
            data.forEach(([convId, timestamp]) => {
                conversationOpenTimes.set(convId, new Date(timestamp));
                console.log(`Loaded open time for conversation ${convId}: ${timestamp}`);
            });
        } catch (e) {
            console.error('Error loading conversation open times:', e);
        }
    } else {
        console.log('No stored conversation open times found');
    }
    console.log('Final conversation open times:', Array.from(conversationOpenTimes.entries()));
}

// Save conversation open times to localStorage
function saveConversationOpenTimes() {
    const data = Array.from(conversationOpenTimes.entries()).map(([convId, date]) => [convId, date.toISOString()]);
    console.log('Saving conversation open times:', data);
    localStorage.setItem('conversationOpenTimes', JSON.stringify(data));
    console.log('Saved to localStorage');
}

// Open conversation
async function openConversation(conversationId) {
    console.log('Opening conversation:', conversationId);
    // Store the time when this conversation was opened
    conversationOpenTimes.set(conversationId, new Date());
    console.log('Set open time for conversation:', conversationId);
    saveConversationOpenTimes(); // Persist to localStorage

    // Close previous websocket
    if (websocket) {
        websocket.close();
        websocket = null;
    }

    try {
        console.log('Opening conversation:', conversationId);

        // Close previous websocket
        if (websocket) {
            websocket.close();
            websocket = null;
        }

        // Update active state
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
        });
        const activeItem = document.querySelector(`[data-conversation-id="${conversationId}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }

        // Show chat container
        hideWorkspaceView();
        document.getElementById('chatPlaceholder').style.display = 'none';
        document.getElementById('chatContainer').style.display = 'flex';

        // Load conversation details
        try {
            console.log('Fetching conversation details...');
            const response = await fetch(`/api/messaging/conversations/${conversationId}/`);
            console.log('Conversation details response status:', response.status);

            const data = await response.json();
            console.log('Conversation details data:', data);

            currentConversation = data.conversation;

            // Update chat header
            updateChatHeader(currentConversation);

            // Load messages via HTTP
            console.log('Loading messages...');
            await loadMessages(conversationId);

            // WebSocket disabled for now - using HTTP polling
            // connectWebSocket(conversationId);

            // Mark messages as read
            markMessagesAsRead(conversationId);

            // Reload conversations to get updated data
            loadConversations();

            // Show group info button if group
            document.getElementById('groupInfoBtn').style.display =
                currentConversation.conversation_type === 'group' ? 'block' : 'none';

            // Setup group info button
            document.getElementById('groupInfoBtn').onclick = () => showGroupInfo(conversationId);

            // Load help desk containers if this is IT help desk group
            if (currentConversation.is_help_desk) {
                loadHelpDeskContainers();

                // Show global work-status button in header for helpdesk group
                const helpdeskWorkStatusBtn = document.getElementById('helpdeskWorkStatusBtn');
                if (helpdeskWorkStatusBtn) {
                    // Use conversation-level permission immediately after opening chat.
                    // can_create_request=false means IT member; true means normal user.
                    const isItByConversation = currentConversation.can_create_request === false;
                    if (isItByConversation) {
                        helpdeskWorkStatusBtn.style.display = 'block';
                        helpdeskWorkStatusBtn.onclick = () => toggleHelpdeskWorkStatusModal(true);
                    } else {
                        helpdeskWorkStatusBtn.style.display = 'none';
                        helpdeskWorkStatusBtn.onclick = null;
                    }
                }
            } else {
                const helpdeskWorkStatusBtn = document.getElementById('helpdeskWorkStatusBtn');
                if (helpdeskWorkStatusBtn) {
                    helpdeskWorkStatusBtn.style.display = 'none';
                    helpdeskWorkStatusBtn.onclick = null;
                }
                // Hide help desk containers if not help desk group
                const helpdeskContainers = document.getElementById('helpdeskContainers');
                const messagesContainer = document.getElementById('messagesContainer');
                if (helpdeskContainers) {
                    helpdeskContainers.style.display = 'none';
                }
                if (messagesContainer) {
                    messagesContainer.style.display = 'block';
                }

                // Restore message input area visibility when leaving IT help desk
                const messageInputArea = document.getElementById('messageInputArea');
                if (messageInputArea) {
                    messageInputArea.style.display = 'flex';
                }
            }

            // Hide message bar for normal users in specific groups only
            const messageInput = document.getElementById('messageInput');
            const sendMessageBtn = document.getElementById('sendMessageBtn');
            const messageContainer = document.querySelector('.message-input-container');

            // Check if this is a group where normal users cannot send messages
            const isRestrictedGroup = (
                currentConversation.conversation_type === 'group' &&
                currentConversation.can_send_messages === false
            );

            if (isRestrictedGroup) {
                // Hide message input and send button for restricted groups
                if (messageInput) messageInput.style.display = 'none';
                if (sendMessageBtn) sendMessageBtn.style.display = 'none';
                if (messageContainer) messageContainer.style.display = 'none';

                // Show read-only message for GTI members group
                if (currentConversation.name === 'GTI members') {
                    const chatContainer = document.getElementById('chatContainer');
                    const readOnlyMessage = document.createElement('div');
                    readOnlyMessage.className = 'read-only-message';
                    readOnlyMessage.innerHTML = `
                        <div style="text-align: center; padding: 20px; color: #666; background: #f5f5f5; border-radius: 8px; margin: 10px;">
                            <i class="fas fa-lock" style="font-size: 24px; margin-bottom: 10px; display: block;"></i>
                            <p style="margin: 0; font-weight: 500;">Only IT members can send messages in this group</p>
                            <p style="margin: 5px 0 0 0; font-size: 12px; color: #999;">You can only view messages</p>
                        </div>
                    `;
                    chatContainer.appendChild(readOnlyMessage);
                }
            } else {
                // Show message input and send button for unrestricted conversations
                if (messageInput) messageInput.style.display = 'block';
                if (sendMessageBtn) sendMessageBtn.style.display = 'block';
                if (messageContainer) messageContainer.style.display = 'flex';

                // Remove read-only message if exists
                const readOnlyMessage = document.querySelector('.read-only-message');
                if (readOnlyMessage) readOnlyMessage.remove();
            }

        } catch (error) {
            console.error('Error opening conversation:', error);
            alert('Error opening conversation: ' + error.message);
        }
    } catch (error) {
        console.error('Error opening conversation:', error);
        alert('Error opening conversation: ' + error.message);
    }
}

// Reset unread count for opened conversation
function resetConversationUnreadCount(conversationId) {
    console.log('Resetting unread count for conversation:', conversationId);
    const conversationElement = document.querySelector(`[data-conversation-id="${conversationId}"]`);
    console.log('Conversation element found:', conversationElement);

    if (conversationElement) {
        const unreadBadge = conversationElement.querySelector('.unread-badge');
        console.log('Unread badge found:', unreadBadge);

        if (unreadBadge) {
            // Completely remove the badge element
            unreadBadge.remove();
            console.log('Unread badge removed completely');
        } else {
            console.log('No unread badge found in conversation element');
        }
    } else {
        console.log('Conversation element not found with id:', conversationId);
    }
}

// Update chat header
function updateChatHeader(conversation) {
    const contactName = document.getElementById('contactName');
    const contactStatus = document.getElementById('contactStatus');
    const contactAvatar = document.getElementById('contactAvatar');

    if (!contactName || !contactStatus) {
        console.error('Chat header elements not found');
        return;
    }

    // Hide avatar
    if (contactAvatar) {
        contactAvatar.style.display = 'none';
    }

    contactName.textContent = conversation.name;
    contactStatus.textContent =
        conversation.conversation_type === 'group'
            ? `${conversation.participants.length} participants`
            : '';
}

// Load messages
async function loadMessages(conversationId) {
    try {
        console.log('Loading messages for conversation:', conversationId);
        const response = await fetch(`/api/messaging/conversations/${conversationId}/messages/`);
        console.log('Response status:', response.status);

        const data = await response.json();
        console.log('Messages data:', data);

        const container = document.getElementById('messagesContainer');
        container.innerHTML = '';

        if (data.messages && data.messages.length > 0) {
            data.messages.forEach((msg, index) => {
                console.log('Creating message:', msg);
                const msgElement = createMessageElement({
                    ...msg,
                    is_self: msg.sender_id === currentUser.id,
                    is_first: index === 0  // Mark first message
                });
                container.appendChild(msgElement);
            });
        } else {
            console.log('No messages found');
            container.innerHTML = '<div style="text-align: center; color: #8696a0; padding: 20px;">No messages yet</div>';
        }

        container.scrollTop = container.scrollHeight;
    } catch (error) {
        console.error('Error loading messages:', error);
        const container = document.getElementById('messagesContainer');
        container.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 20px;">Error loading messages</div>';
    }
}

// Create message element
function createMessageElement(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.is_self ? 'sent' : 'received'}`;
    div.dataset.messageId = msg.id;

    let content = '';

    // Sender name for received messages (like WhatsApp groups)
    if (!msg.is_self && (msg.sender_full_name || msg.sender_username)) {
        const senderName = msg.sender_full_name || msg.sender_username;
        content += `<div class="message-sender">${escapeHtml(senderName)}</div>`;
    }

    // Reply preview
    if (msg.reply_to_id) {
        const replySender = msg.reply_to_sender || msg.reply_to_sender_username || msg.reply_to_sender_id || 'Unknown';
        content += `
            <div class="reply-preview">
                <div class="reply-preview-text"><strong>${escapeHtml(replySender)}</strong>: ${escapeHtml(msg.reply_to_content || 'a message').substring(0, 80)}</div>
            </div>
        `;
    }

    // Media content
    if (msg.message_type !== 'text' && msg.media_file) {
        const mediaUrl = getAbsoluteFileUrl(msg.media_file);
        if (msg.message_type === 'image') {
            content += `<img src="${mediaUrl}" class="message-media media-file" data-file-url="${mediaUrl}" data-file-name="${msg.file_name || ''}" data-message-type="${msg.message_type}" alt="Image" style="cursor: pointer;">`;
        } else if (msg.message_type === 'video') {
            content += `<video src="${mediaUrl}" class="message-media media-file" data-file-url="${mediaUrl}" data-file-name="${msg.file_name || ''}" data-message-type="${msg.message_type}" controls style="cursor: pointer;"></video>`;
        } else {
            content += `
                <div class="message-media file-message media-file" data-file-url="${mediaUrl}" data-file-name="${msg.file_name || ''}" data-message-type="${msg.message_type}" style="background: #202c33; padding: 12px; border-radius: 8px; cursor: pointer;">
                    <i class="fas fa-file" style="font-size: 24px; margin-bottom: 8px;"></i>
                    <div>${msg.file_name}</div>
                    <div style="color: #00a884; font-size: 12px;">Click to open</div>
                </div>
            `;
        }
    }

    // Text content
    if (msg.content) {
        content += `<div class="message-content">${escapeHtml(msg.content)}</div>`;
    }

    // Meta info with three dots menu
    content += `
        <div class="message-meta">
            <span class="message-time">${formatTime(msg.created_at)}</span>
            ${msg.is_self ? `<span class="message-status">${getMessageStatusIcon(msg.status)}</span>` : ''}
            ${msg.edited ? '<span class="message edited">edited</span>' : ''}
        </div>
        <div class="message-menu-container">
            <button class="message-menu-btn" data-message-id="${msg.id}" title="Message options">
                <i class="fas fa-ellipsis-v"></i>
            </button>
                <div class="message-options-dropdown" id="message-options-${msg.id}" style="display: none;">
                    <div class="message-option-item" data-action="reply" data-message-id="${msg.id}"><i class="fas fa-reply"></i> Reply</div>
                    <div class="message-option-item" data-action="forward" data-message-id="${msg.id}"><i class="fas fa-share"></i> Forward</div>
                    <div class="message-option-item" data-action="info" data-message-id="${msg.id}"><i class="fas fa-info-circle"></i> Info</div>
                    ${msg.is_self && msg.message_type === 'text' ? `<div class="message-option-item" data-action="edit" data-message-id="${msg.id}"><i class="fas fa-edit"></i> Edit</div>` : ''}
                    ${msg.is_self ? `
                    <div class="message-option-item delete-option" data-action="delete" data-message-id="${msg.id}">
                        <i class="fas fa-trash"></i> Delete
                        <div class="delete-submenu" style="display: none;">
                            <div class="message-option-item" data-action="delete-me" data-message-id="${msg.id}"><i class="fas fa-user"></i> Delete for me</div>
                            <div class="message-option-item" data-action="delete-everyone" data-message-id="${msg.id}"><i class="fas fa-users"></i> Delete for everyone</div>
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;

    div.innerHTML = content;

    // Add click listener for message options menu
    const menuBtn = div.querySelector('.message-menu-btn');
    const optionsDropdown = div.querySelector('.message-options-dropdown');
    if (menuBtn && optionsDropdown) {
        menuBtn.addEventListener('click', (e) => toggleMessageOptions(msg.id, optionsDropdown, e));

        // Add click listeners for option items
        optionsDropdown.querySelectorAll('.message-option-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                handleMessageOption(item.dataset.action, msg, item);
            });
        });
    }

    return div;
}

function escapeAttr(text) {
    return escapeHtml(String(text || '')).replace(/`/g, '&#96;');
}

function getFileBaseName(fileName) {
    const cleaned = String(fileName || '').split('?')[0].trim();
    if (!cleaned) return '';
    const parts = cleaned.split('/');
    return parts[parts.length - 1] || cleaned;
}

function resolveFileName(fileUrl, fileName, messageType) {
    let name = getFileBaseName(fileName) || getFileBaseName(fileUrl) || 'file';

    if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
        if (messageType === 'image') name += '.jpg';
        else if (messageType === 'video') name += '.mp4';
    }

    return name;
}

function getFileKind(fileUrl, fileName, messageType) {
    const resolvedName = resolveFileName(fileUrl, fileName, messageType);
    const baseName = getFileBaseName(resolvedName).toLowerCase();

    if (messageType === 'image') return 'image';
    if (messageType === 'video') return 'video';
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(baseName)) return 'image';
    if (/\.(mp4|webm|ogg|avi|mov)$/i.test(baseName)) return 'video';
    if (/\.pdf$/i.test(baseName)) return 'pdf';
    return 'document';
}

function getAbsoluteFileUrl(fileUrl) {
    if (!fileUrl) return '';

    const rawUrl = String(fileUrl).trim();
    if (!rawUrl) return '';

    if (/^https?:\/\//i.test(rawUrl)) {
        try {
            const parsedUrl = new URL(rawUrl);
            if (parsedUrl.pathname.startsWith('/media/')) {
                const relativePath = parsedUrl.pathname.replace(/^\/media\//, '').split('/').map(segment => encodeURIComponent(segment)).join('/');
                return `${window.location.origin}/api/messaging/media/${relativePath}`;
            }
            return rawUrl;
        } catch (error) {
            return rawUrl;
        }
    }

    if (rawUrl.startsWith('/media/')) {
        const relativePath = rawUrl.replace(/^\/media\//, '').split('/').map(segment => encodeURIComponent(segment)).join('/');
        return `${window.location.origin}/api/messaging/media/${relativePath}`;
    }
    if (rawUrl.startsWith('/')) {
        return `${window.location.origin}${rawUrl}`;
    }
    return rawUrl;
}

function openPdfInBrowser(fileUrl) {
    const absoluteUrl = getAbsoluteFileUrl(fileUrl);
    if (window.electronAPI && window.electronAPI.openFileBrowser) {
        window.electronAPI.openFileBrowser(absoluteUrl);
        return;
    }
    if (isElectronApp()) {
        window.postMessage({
            type: 'desktop-file-open-browser',
            fileUrl: absoluteUrl
        }, '*');
        return;
    }
    window.open(absoluteUrl, '_blank');
}

function cleanupImageViewerHandlers() {
    if (!imageViewerDragHandlers) return;
    window.removeEventListener('mousemove', imageViewerDragHandlers.onMove);
    window.removeEventListener('mouseup', imageViewerDragHandlers.onUp);
    imageViewerDragHandlers = null;
}

async function sendFileBufferToDesktop(buffer, fileName) {
    const byteArray = Array.from(new Uint8Array(buffer));

    if (window.electronAPI && window.electronAPI.openFileBuffer) {
        window.electronAPI.openFileBuffer(byteArray, fileName);
        return true;
    }

    if (isElectronApp()) {
        window.postMessage({
            type: 'desktop-file-open-buffer',
            buffer: byteArray,
            fileName: fileName
        }, '*');
        return true;
    }

    return false;
}

function sendFileUrlToDesktop(fileUrl, fileName) {
    if (window.electronAPI && window.electronAPI.openFileExternal) {
        window.electronAPI.openFileExternal(fileUrl, fileName);
        return true;
    }

    if (isElectronApp()) {
        window.postMessage({
            type: 'desktop-file-open',
            fileUrl: fileUrl,
            fileName: fileName
        }, '*');
        return true;
    }

    return false;
}

async function openDocumentExternally(fileUrl, fileName) {
    const resolvedName = resolveFileName(fileUrl, fileName);
    const absoluteUrl = getAbsoluteFileUrl(fileUrl);

    try {
        if (isElectronApp()) {
            if (sendFileUrlToDesktop(absoluteUrl, resolvedName)) {
                return;
            }
        }

        const opened = window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
        if (!opened) {
            showToast('Please allow pop-ups to open this file', 'error');
        }
    } catch (error) {
        console.error('Unable to open document:', error);
        if (isElectronApp() && sendFileUrlToDesktop(absoluteUrl, resolvedName)) {
            return;
        }
        showToast('Unable to open file. Please try again.', 'error');
    }
}

// Images/videos/PDF in-app, documents in WPS/Office
function openFile(fileUrl, fileName, messageType) {
    if (!fileUrl) return;

    const resolvedName = resolveFileName(fileUrl, fileName, messageType);
    const kind = getFileKind(fileUrl, fileName, messageType);

    if (kind === 'image') {
        openFileViewer(fileUrl, 'image', resolvedName);
    } else if (kind === 'video') {
        openFileViewer(fileUrl, 'video', resolvedName);
    } else if (kind === 'pdf') {
        openFileViewer(fileUrl, 'pdf', resolvedName);
    } else {
        openDocumentExternally(fileUrl, resolvedName);
    }
}

// Open file in WhatsApp-style modal viewer
async function openFileViewer(fileUrl, fileType, fileName) {
    cleanupImageViewerHandlers();

    const container = document.getElementById('fileViewerContainer');
    const modal = document.getElementById('fileViewerModal');
    if (!container || !modal) {
        showToast('Unable to open file viewer', 'error');
        return;
    }

    const sanitizedUrl = getAbsoluteFileUrl(fileUrl);
    const displayUrl = escapeAttr(sanitizedUrl);

    if (fileType === 'image') {
        container.innerHTML = `
            <div class="image-viewer-wrapper">
                <img id="zoomedImage" src="" alt="Image" style="transform: translate(0px, 0px) scale(1); cursor: grab; transition: transform 0.1s ease-out;">
                <div class="image-viewer-toolbar">
                    <button class="zoom-btn" id="zoomInBtn" title="Zoom In"><i class="fas fa-search-plus"></i></button>
                    <button class="zoom-btn" id="zoomOutBtn" title="Zoom Out"><i class="fas fa-search-minus"></i></button>
                    <button class="zoom-btn" id="zoomResetBtn" title="Reset"><i class="fas fa-expand-arrows-alt"></i></button>
                </div>
            </div>
        `;

        const zoomedImage = document.getElementById('zoomedImage');
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const zoomResetBtn = document.getElementById('zoomResetBtn');

        if (!zoomedImage || !zoomInBtn || !zoomOutBtn || !zoomResetBtn) {
            showToast('Unable to open image viewer', 'error');
            return;
        }

        zoomedImage.onerror = () => {
            showToast('Unable to load image', 'error');
            closeFileViewer();
        };

        zoomedImage.onload = () => {
            if (zoomedImage.src.startsWith('blob:')) {
                return;
            }
        };

        let scale = 1;
        let translateX = 0;
        let translateY = 0;
        let isDragging = false;
        let startX = 0;
        let startY = 0;

        const updateTransform = () => {
            zoomedImage.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
            zoomedImage.style.cursor = scale > 1 ? 'grab' : 'default';
        };

        zoomInBtn.onclick = (e) => {
            e.stopPropagation();
            scale = Math.min(scale * 1.25, 8);
            updateTransform();
        };

        zoomOutBtn.onclick = (e) => {
            e.stopPropagation();
            scale = Math.max(scale / 1.25, 0.5);
            if (scale <= 1) {
                translateX = 0;
                translateY = 0;
            }
            updateTransform();
        };

        zoomResetBtn.onclick = (e) => {
            e.stopPropagation();
            scale = 1;
            translateX = 0;
            translateY = 0;
            updateTransform();
        };

        const onMove = (e) => {
            if (!isDragging) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateTransform();
        };

        const onUp = () => {
            if (!isDragging) return;
            isDragging = false;
            zoomedImage.style.cursor = 'grab';
        };

        imageViewerDragHandlers = { onMove, onUp };

        zoomedImage.addEventListener('mousedown', (e) => {
            if (scale > 1) {
                isDragging = true;
                zoomedImage.style.cursor = 'grabbing';
                startX = e.clientX - translateX;
                startY = e.clientY - translateY;
                e.preventDefault();
            }
        });

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);

        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = 1.1;
            if (e.deltaY < 0) {
                scale = Math.min(scale * zoomFactor, 8);
            } else {
                scale = Math.max(scale / zoomFactor, 0.5);
                if (scale <= 1) {
                    translateX = 0;
                    translateY = 0;
                }
            }
            updateTransform();
        }, { passive: false });

        zoomedImage.src = displayUrl;

        if (activeClickedImg && activeClickedImg.getBoundingClientRect) {
            const rect = activeClickedImg.getBoundingClientRect();
            zoomedImage.style.transition = 'none';
            zoomedImage.style.position = 'fixed';
            zoomedImage.style.top = rect.top + 'px';
            zoomedImage.style.left = rect.left + 'px';
            zoomedImage.style.width = rect.width + 'px';
            zoomedImage.style.height = rect.height + 'px';
            zoomedImage.style.objectFit = 'cover';
            zoomedImage.style.borderRadius = getComputedStyle(activeClickedImg).borderRadius;

            modal.classList.add('active');
            modal.style.opacity = '0';
            modal.style.transition = 'opacity 0.25s ease';
            void modal.offsetWidth;
            modal.style.opacity = '1';

            setTimeout(() => {
                zoomedImage.style.transition = 'all 0.3s cubic-bezier(0.1, 0.8, 0.25, 1)';
                zoomedImage.style.position = 'absolute';
                zoomedImage.style.top = '50%';
                zoomedImage.style.left = '50%';
                zoomedImage.style.width = 'auto';
                zoomedImage.style.height = 'auto';
                zoomedImage.style.maxWidth = '100vw';
                zoomedImage.style.maxHeight = '100vh';
                zoomedImage.style.transform = 'translate(-50%, -50%) scale(1)';
                zoomedImage.style.objectFit = 'contain';
                zoomedImage.style.borderRadius = '0';
            }, 10);
        } else {
            modal.classList.add('active');
        }
    } else if (fileType === 'video') {
        console.log('Setting video content');
        container.innerHTML = `<video src="${displayUrl}" controls autoplay style="max-width: 100%; max-height: 100%;"></video>`;
        modal.classList.add('active');
    } else if (fileType === 'pdf') {
        container.innerHTML = `
            <div class="pdf-viewer-wrapper">
                <div class="pdf-viewer-toolbar">
                    <span class="pdf-title">${escapeHtml(fileName)}</span>
                </div>
                <iframe id="pdfViewerFrame" title="${escapeHtml(fileName)}" style="flex: 1; width: 100%; height: 100%; border: none;"></iframe>
            </div>
        `;
        const pdfFrame = document.getElementById('pdfViewerFrame');
        pdfFrame.src = displayUrl;
        modal.classList.add('active');
    } else if (fileType === 'document') {
        const ext = fileName.split('.').pop().toLowerCase();
        let docIconHtml = '';
        
        switch (ext) {
            case 'doc':
            case 'docx':
                docIconHtml = '<i class="fas fa-file-word" style="color: #2196f3; font-size: 64px;"></i>';
                break;
            case 'xls':
            case 'xlsx':
                docIconHtml = '<i class="fas fa-file-excel" style="color: #4caf50; font-size: 64px;"></i>';
                break;
            case 'ppt':
            case 'pptx':
                docIconHtml = '<i class="fas fa-file-powerpoint" style="color: #ff9800; font-size: 64px;"></i>';
                break;
            case 'zip':
            case 'rar':
            case '7z':
            case 'tar':
            case 'gz':
                docIconHtml = '<i class="fas fa-file-archive" style="color: #9c27b0; font-size: 64px;"></i>';
                break;
            case 'txt':
                docIconHtml = '<i class="fas fa-file-alt" style="color: #607d8b; font-size: 64px;"></i>';
                break;
            default:
                docIconHtml = '<i class="fas fa-file" style="color: #aebac1; font-size: 64px;"></i>';
        }

        container.innerHTML = `
            <div class="document-viewer-wrapper">
                <div class="document-info-card">
                    <div class="document-icon-large">${docIconHtml}</div>
                    <div class="document-name-large">${escapeHtml(fileName)}</div>
                    <div class="document-meta-large">${ext.toUpperCase()} Document</div>
                </div>
                <div class="document-viewer-actions">
                    <button class="doc-action-btn open-btn" id="docOpenBtn">
                        <i class="fas fa-external-link-alt"></i> Open
                    </button>
                    <button class="doc-action-btn save-btn" id="docSaveBtn">
                        <i class="fas fa-download"></i> Save / Download
                    </button>
                </div>
            </div>
        `;

        const inlineUrl = getAbsoluteFileUrl(fileUrl);

        document.getElementById('docOpenBtn').onclick = (e) => {
            e.stopPropagation();
            window.open(inlineUrl, '_blank');
        };

        document.getElementById('docSaveBtn').onclick = (e) => {
            e.stopPropagation();
            const link = document.createElement('a');
            link.href = inlineUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        modal.classList.add('active');
    }
}

// Close file viewer with animation back to its location
function closeFileViewer() {
    const modal = document.getElementById('fileViewerModal');
    const zoomedImage = document.getElementById('zoomedImage');

    if (zoomedImage && activeClickedImg) {
        const rect = activeClickedImg.getBoundingClientRect();
        const currentRect = zoomedImage.getBoundingClientRect();
        
        zoomedImage.style.transition = 'none';
        zoomedImage.style.position = 'fixed';
        zoomedImage.style.top = currentRect.top + 'px';
        zoomedImage.style.left = currentRect.left + 'px';
        zoomedImage.style.width = currentRect.width + 'px';
        zoomedImage.style.height = currentRect.height + 'px';
        zoomedImage.style.transform = 'none';

        void zoomedImage.offsetWidth; // Reflow

        zoomedImage.style.transition = 'all 0.3s cubic-bezier(0.1, 0.8, 0.25, 1)';
        zoomedImage.style.top = rect.top + 'px';
        zoomedImage.style.left = rect.left + 'px';
        zoomedImage.style.width = rect.width + 'px';
        zoomedImage.style.height = rect.height + 'px';
        zoomedImage.style.objectFit = 'cover';
        zoomedImage.style.borderRadius = getComputedStyle(activeClickedImg).borderRadius;

        modal.style.transition = 'opacity 0.25s ease';
        modal.style.opacity = '0';

        setTimeout(() => {
            modal.classList.remove('active');
            modal.style.opacity = '';
            modal.style.transition = '';
            const container = document.getElementById('fileViewerContainer');
            container.innerHTML = '';
            activeClickedImg = null;
        }, 300);
    } else {
        modal.classList.remove('active');
        const container = document.getElementById('fileViewerContainer');
        container.innerHTML = '';
        activeClickedImg = null;
    }
}

// Get message status icon
function getMessageStatusIcon(status) {
    switch (status) {
        case 'sent':
            return '<i class="fas fa-check"></i>';
        case 'delivered':
            return '<i class="fas fa-check-double"></i>';
        case 'seen':
            return '<i class="fas fa-check-double" style="color: #53bdeb;"></i>';
        default:
            return '';
    }
}

// Toggle message options dropdown
function toggleMessageOptions(messageId, dropdown, event) {
    event.stopPropagation();

    // Close all other dropdowns
    document.querySelectorAll('.message-options-dropdown').forEach(d => {
        if (d !== dropdown) d.style.display = 'none';
    });

    // Toggle current dropdown
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';

    // Close when clicking outside
    if (!isVisible) {
        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
                document.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => document.addEventListener('click', closeDropdown), 0);
    }
}

// Handle message option actions
async function handleMessageOption(action, msg, element) {
    const dropdown = document.getElementById(`message-options-${msg.id}`);

    switch (action) {
        case 'reply':
            dropdown.style.display = 'none';
            startReplyToMessage(msg);
            break;
        case 'forward':
            dropdown.style.display = 'none';
            openForwardModal(msg);
            break;
        case 'info':
            dropdown.style.display = 'none';
            showMessageInfoDialog(msg.id);
            break;
        case 'edit':
            dropdown.style.display = 'none';
            startEditMessage(msg);
            break;
        case 'delete':
            // Show delete submenu
            const submenu = element.querySelector('.delete-submenu');
            if (submenu) {
                submenu.style.display = submenu.style.display === 'block' ? 'none' : 'block';
            }
            break;
        case 'delete-me':
            dropdown.style.display = 'none';
            deleteMessageForMe(msg.id);
            break;
        case 'delete-everyone':
            dropdown.style.display = 'none';
            deleteMessageForEveryone(msg.id);
            break;
    }
}

// Show message info dialog (read receipts)
async function showMessageInfoDialog(messageId) {
    let modal = document.getElementById('messageInfoModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'messageInfoModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content message-info-content">
                <div class="modal-header">
                    <h3>Message Info</h3>
                    <button class="close-btn" onclick="closeMessageInfoModal()">&times;</button>
                </div>
                <div class="modal-body" id="messageInfoBody">Loading...</div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
    const body = document.getElementById('messageInfoBody');
    body.innerHTML = 'Loading...';

    try {
        console.log('Fetching read receipts for message:', messageId);
        const response = await fetch(`/api/messaging/messages/${messageId}/read-receipts/`);
        const data = await response.json();
        console.log('Read receipts data:', data);

        let html = '<div class="message-info-sections">';

        if (data.read_by && data.read_by.length > 0) {
            console.log('Users who read:', data.read_by);
            html += `
                <div class="info-section">
                    <div class="info-section-title">Read by ${data.read_count} of ${data.total_participants}</div>
                    ${data.read_by.map(user => `
                        <div class="info-item read">
                            <span class="info-name">${escapeHtml(user.full_name || user.username)}</span>
                            <span class="info-time">${formatTime(user.read_at)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (data.not_read_by && data.not_read_by.length > 0) {
            console.log('Users who have not read:', data.not_read_by);
            html += `
                <div class="info-section">
                    <div class="info-section-title">Delivered to ${data.unread_count} of ${data.total_participants}</div>
                    ${data.not_read_by.map(user => `
                        <div class="info-item delivered">
                            <span class="info-name">${escapeHtml(user.full_name || user.username)}</span>
                            <span class="info-status">Not read yet</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (data.read_by.length === 0 && data.not_read_by.length === 0) {
            html += '<div class="info-empty">No other participants</div>';
        }

        html += '</div>';
        body.innerHTML = html;
    } catch (error) {
        console.error('Error loading message info:', error);
        body.innerHTML = '<div class="error">Error loading message info</div>';
    }
}

function closeMessageInfoModal() {
    const modal = document.getElementById('messageInfoModal');
    if (modal) modal.style.display = 'none';
}

// Start replying to a message
function startReplyToMessage(msg) {
    const messageInput = document.getElementById('messageInput');
    const messagesContainer = document.getElementById('messagesContainer');

    // Scroll to the message being replied to
    const msgElement = document.querySelector(`[data-message-id="${msg.id}"]`);
    if (msgElement) {
        msgElement.classList.add('highlight-reply');
        setTimeout(() => msgElement.classList.remove('highlight-reply'), 2000);
    }

    // Set up reply input
    messageInput.dataset.replyTo = msg.id;
    messageInput.placeholder = `Replying to: ${msg.sender_username || msg.sender_full_name}`;

    // Show reply preview above input
    showReplyPreview(msg);

    // Focus input
    messageInput.focus();
}

// Show reply preview in message input area
function showReplyPreview(msg) {
    let previewContainer = document.getElementById('replyPreviewContainer');

    if (!previewContainer) {
        previewContainer = document.createElement('div');
        previewContainer.id = 'replyPreviewContainer';
        const messageInput = document.getElementById('messageInput');
        messageInput.parentNode.insertBefore(previewContainer, messageInput);
    }

    const previewText = msg.content || `[${msg.message_type.toUpperCase()}]`;
    previewContainer.innerHTML = `
        <div class="reply-preview-input">
            <div class="reply-preview-item">
                <div class="reply-preview-header">Replying to ${msg.sender_username || msg.sender_full_name}</div>
                <div class="reply-preview-content">${escapeHtml(previewText.substring(0, 100))}${previewText.length > 100 ? '...' : ''}</div>
            </div>
            <button class="reply-preview-close" onclick="clearReplyPreview()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    previewContainer.style.display = 'block';
}

// Clear reply preview
function clearReplyPreview() {
    const messageInput = document.getElementById('messageInput');
    messageInput.dataset.replyTo = '';
    messageInput.placeholder = 'Type a message...';

    const previewContainer = document.getElementById('replyPreviewContainer');
    if (previewContainer) {
        previewContainer.style.display = 'none';
    }
}

// Open forward message modal
async function openForwardModal(msg) {
    let modal = document.getElementById('forwardModal');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'forwardModal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    // Show modal with loading state
    modal.innerHTML = `
        <div class="modal-content forward-modal-content">
            <div class="modal-header">
                <h3>Forward Message</h3>
                <button class="close-btn" onclick="closeForwardModal()">&times;</button>
            </div>
            <div class="modal-body">
                <input type="text" id="forwardSearchInput" placeholder="Search conversations..." class="form-control" style="margin-bottom: 15px;">
                <div id="forwardConversationsList" class="forward-conversations-list">
                    <div style="text-align: center; color: #8696a0; padding: 20px;">Loading conversations...</div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeForwardModal()">Cancel</button>
                <button class="btn btn-primary" id="forwardSendBtn" onclick="sendForwardedMessage('${msg.id}')" style="display: none;">Forward to Selected</button>
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    // Load conversations
    await loadForwardConversations();

    // Setup search
    const searchInput = document.getElementById('forwardSearchInput');
    searchInput.addEventListener('input', filterForwardConversations);
}

// Load conversations for forwarding
async function loadForwardConversations() {
    try {
        const response = await fetch('/api/messaging/conversations/');
        const data = await response.json();

        const conversationsList = document.getElementById('forwardConversationsList');
        conversationsList.innerHTML = '';

        data.conversations.forEach(conv => {
            const convElement = document.createElement('div');
            convElement.className = 'forward-conversation-item';
            convElement.dataset.conversationId = conv.id;

            let convName = conv.name || '';
            if (conv.conversation_type === 'group') {
                convName = conv.name || conv.group_name || 'Group';
            } else {
                convName = conv.username || conv.name || conv.other_participant_name || 'User';
            }

            convElement.innerHTML = `
                <input type="checkbox" class="forward-checkbox" data-conv-id="${conv.id}" onchange="toggleForwardSelection()">
                <label>${escapeHtml(convName)}</label>
            `;

            conversationsList.appendChild(convElement);
        });

        if (data.conversations.length === 0) {
            conversationsList.innerHTML = '<div style="text-align: center; color: #8696a0; padding: 20px;">No conversations available</div>';
        }
    } catch (error) {
        console.error('Error loading conversations:', error);
        const conversationsList = document.getElementById('forwardConversationsList');
        conversationsList.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 20px;">Error loading conversations</div>';
    }
}

// Filter forward conversations
function filterForwardConversations() {
    const searchText = document.getElementById('forwardSearchInput').value.toLowerCase();
    const items = document.querySelectorAll('.forward-conversation-item');

    items.forEach(item => {
        const label = item.querySelector('label').textContent.toLowerCase();
        item.style.display = label.includes(searchText) ? 'flex' : 'none';
    });
}

// Toggle forward selection and show/hide send button
function toggleForwardSelection() {
    const checkboxes = document.querySelectorAll('.forward-checkbox:checked');
    const sendBtn = document.getElementById('forwardSendBtn');

    if (sendBtn) {
        sendBtn.style.display = checkboxes.length > 0 ? 'block' : 'none';
    }
}

// Send forwarded message
async function sendForwardedMessage(messageId) {
    const checkboxes = document.querySelectorAll('.forward-checkbox:checked');

    if (checkboxes.length === 0) {
        showToast('Please select at least one conversation', 'error');
        return;
    }

    try {
        // Get the original message content
        let messageContent = '';
        let messageType = 'text';

        // Try to find the message in the current messages
        const msgElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (msgElement) {
            const contentEl = msgElement.querySelector('.message-content');
            if (contentEl) {
                messageContent = contentEl.textContent;
            }
            // Get message type from the message element
            const mediaEl = msgElement.querySelector('.message-media');
            if (mediaEl) {
                messageType = 'forwarded';
            }
        }

        // Get selected conversation IDs
        const conversationIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.convId));

        // Send to each selected conversation
        const sendPromises = conversationIds.map(convId =>
            fetch('/api/messaging/messages/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({
                    conversation_id: convId,
                    content: messageContent,
                    message_type: 'text'
                })
            })
        );

        const results = await Promise.all(sendPromises);

        if (results.every(r => r.ok)) {
            showToast('Message forwarded successfully!', 'success');
            closeForwardModal();
            loadConversations();
            loadMessages(currentConversation.id);
        } else {
            showToast('Failed to forward message to some conversations', 'error');
        }
    } catch (error) {
        console.error('Error forwarding message:', error);
        showToast('Error forwarding message', 'error');
    }
}

// Close forward modal
function closeForwardModal() {
    const modal = document.getElementById('forwardModal');
    if (modal) modal.style.display = 'none';
}

// Start editing message
function startEditMessage(msg) {
    const messageEl = document.querySelector(`[data-message-id="${msg.id}"]`);
    if (!messageEl) return;

    const contentEl = messageEl.querySelector('.message-content');
    if (!contentEl) return;

    // Check if within 5 minutes
    const msgTime = new Date(msg.created_at);
    const now = new Date();
    const diffMinutes = (now - msgTime) / 60000;

    if (diffMinutes > 5) {
        showToast('Messages can only be edited within 5 minutes', 'error');
        return;
    }

    const currentContent = msg.content;

    contentEl.innerHTML = `
        <div class="message-edit-container">
            <input type="text" class="message-edit-input" value="${escapeHtml(currentContent)}" maxlength="1000">
            <div class="message-edit-actions">
                <button class="btn-save" onclick="saveEditMessage(${msg.id}, this)">Save</button>
                <button class="btn-cancel" onclick="cancelEditMessage(${msg.id}, '${escapeHtml(currentContent)}')">Cancel</button>
            </div>
        </div>
    `;

    const input = contentEl.querySelector('.message-edit-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEditMessage(msg.id, contentEl.querySelector('.btn-save'));
        if (e.key === 'Escape') cancelEditMessage(msg.id, currentContent);
    });
}

async function saveEditMessage(messageId, btn) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    const input = messageEl.querySelector('.message-edit-input');
    const newContent = input.value.trim();

    if (!newContent) {
        showToast('Message cannot be empty', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/messaging/messages/${messageId}/edit/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ content: newContent })
        });

        if (response.ok) {
            const contentEl = messageEl.querySelector('.message-content');
            contentEl.textContent = newContent;
            showToast('Message edited', 'success');
        } else {
            const data = await response.json();
            showToast(data.error || 'Failed to edit message', 'error');
        }
    } catch (error) {
        showToast('Failed to edit message', 'error');
    }
}

function cancelEditMessage(messageId, originalContent) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    const contentEl = messageEl.querySelector('.message-content');
    contentEl.textContent = originalContent;
}

// Delete message for me only
async function deleteMessageForMe(messageId) {
    if (!confirm('Delete this message for you?')) return;

    try {
        const response = await fetch(`/api/messaging/messages/${messageId}/delete/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ delete_for: 'me' })
        });

        if (response.ok) {
            const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                messageEl.classList.add('deleted-message');
                // Find the content element (could be message-content or message-media)
                let contentEl = messageEl.querySelector('.message-content');
                if (!contentEl) {
                    contentEl = messageEl.querySelector('.message-media');
                }
                if (contentEl) {
                    contentEl.innerHTML = `<i class="fas fa-trash"></i> You deleted this message`;
                }
            }
            showToast('Message deleted for you', 'success');
        } else {
            showToast('Failed to delete message', 'error');
        }
    } catch (error) {
        showToast('Failed to delete message', 'error');
    }
}

// Delete message for everyone
async function deleteMessageForEveryone(messageId) {
    if (!confirm('Delete this message for everyone?')) return;

    try {
        const response = await fetch(`/api/messaging/messages/${messageId}/delete/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ delete_for: 'everyone' })
        });

        if (response.ok) {
            const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                messageEl.classList.add('deleted-for-everyone');
                const senderName = currentUser.full_name || currentUser.username;

                // Add deletion notice at the top of the message container
                const deletionNotice = document.createElement('div');
                deletionNotice.className = 'deletion-notice';
                deletionNotice.innerHTML = `<i class="fas fa-ban"></i> Deleted for everyone by ${escapeHtml(senderName)}`;

                // Insert at the beginning of the message
                const firstChild = messageEl.firstChild;
                if (firstChild) {
                    messageEl.insertBefore(deletionNotice, firstChild);
                } else {
                    messageEl.appendChild(deletionNotice);
                }

                // Hide or remove the original content
                const contentEl = messageEl.querySelector('.message-content') || messageEl.querySelector('.message-media');
                if (contentEl) {
                    contentEl.style.display = 'none';
                }

                // Hide the three dots menu
                const menuContainer = messageEl.querySelector('.message-menu-container');
                if (menuContainer) {
                    menuContainer.style.display = 'none';
                }
            }
            showToast('Message deleted for everyone', 'success');
        } else {
            showToast('Failed to delete message', 'error');
        }
    } catch (error) {
        showToast('Failed to delete message', 'error');
    }
}

// Chat menu functionality
let isSelectionMode = false;
let selectedMessages = new Set();

// Toggle chat menu dropdown
function toggleChatMenu() {
    const dropdown = document.getElementById('chatMenuDropdown');
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';

    // Close when clicking outside
    if (dropdown.style.display === 'block') {
        const closeMenu = (e) => {
            if (!e.target.closest('.chat-actions')) {
                dropdown.style.display = 'none';
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }
}

// Clear chat
async function clearChat() {
    if (!currentConversation) return;

    if (!confirm('Clear all messages in this chat? This cannot be undone.')) return;

    try {
        const response = await fetch('/api/messaging/delete-conversation/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ conversation_id: currentConversation.id })
        });

        if (response.ok) {
            document.getElementById('messagesContainer').innerHTML = '';
            showToast('Chat cleared', 'success');
        } else {
            showToast('Failed to clear chat', 'error');
        }
    } catch (error) {
        showToast('Failed to clear chat', 'error');
    }

    document.getElementById('chatMenuDropdown').style.display = 'none';
}

// Enter selection mode
function enterSelectionMode() {
    isSelectionMode = true;
    selectedMessages.clear();
    document.getElementById('messagesContainer').classList.add('select-mode');
    document.getElementById('selectionActionBar').classList.add('active');
    document.getElementById('messageInputArea').style.display = 'none';
    document.getElementById('chatMenuDropdown').style.display = 'none';
    updateSelectionCount();
}

// Exit selection mode
function exitSelectionMode() {
    isSelectionMode = false;
    selectedMessages.clear();
    document.getElementById('messagesContainer').classList.remove('select-mode');
    document.getElementById('selectionActionBar').classList.remove('active');
    document.getElementById('messageInputArea').style.display = 'flex';

    // Remove selected class from all messages
    document.querySelectorAll('.message.selected').forEach(msg => {
        msg.classList.remove('selected');
    });
}

// Toggle message selection
function toggleMessageSelection(messageId) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) return;

    if (selectedMessages.has(messageId)) {
        selectedMessages.delete(messageId);
        messageEl.classList.remove('selected');
    } else {
        selectedMessages.add(messageId);
        messageEl.classList.add('selected');
    }

    updateSelectionCount();
}

// Update selection count
function updateSelectionCount() {
    document.getElementById('selectionCount').textContent = `${selectedMessages.size} selected`;
}

// Delete selected messages
async function deleteSelectedMessages() {
    if (selectedMessages.size === 0) {
        showToast('No messages selected', 'error');
        return;
    }

    if (!confirm(`Delete ${selectedMessages.size} selected message(s)?`)) return;

    try {
        for (const messageId of selectedMessages) {
            const response = await fetch(`/api/messaging/messages/${messageId}/delete/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ delete_for: 'me' })
            });

            if (response.ok) {
                const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
                if (messageEl) {
                    messageEl.remove();
                }
            }
        }

        showToast(`${selectedMessages.size} message(s) deleted`, 'success');
        exitSelectionMode();
    } catch (error) {
        showToast('Failed to delete messages', 'error');
    }
}

// Connect to WebSocket
function connectWebSocket(conversationId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat/${conversationId}/`;

    websocket = new WebSocket(wsUrl);

    websocket.onopen = () => {
        console.log('WebSocket connected');
    };

    websocket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
            case 'chat_message':
                handleNewMessage(data.message);
                break;
            case 'typing_indicator':
                handleTypingIndicator(data);
                break;
            case 'message_read':
                handleMessageRead(data);
                break;
            case 'message_deleted':
                handleMessageDeleted(data);
                break;
            case 'message_edited':
                handleMessageEdited(data);
                break;
        }
    };

    websocket.onclose = () => {
        console.log('WebSocket disconnected');
    };

    websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Connection state management
let wsConnectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
const RETRY_DELAY = 10000; // 10 seconds

// Connect to notification socket
function connectNotificationSocket() {
    // Prevent infinite retry loop
    if (wsConnectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
        console.error('Max WebSocket connection attempts reached. Stopping retries.');
        console.log('WebSocket functionality will be disabled for this session.');
        return;
    }

    wsConnectionAttempts++;
    console.log(`WebSocket connection attempt ${wsConnectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/notifications/`;
    console.log('WebSocket URL:', wsUrl);

    try {
        notificationSocket = new WebSocket(wsUrl);

        notificationSocket.onopen = () => {
            console.log('WebSocket connected successfully');
            notificationSocketConnected = true;
            wsConnectionAttempts = 0; // Reset attempts on successful connection
        };

        notificationSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'notification') {
                if (data.notification && data.notification.notification_type === 'it_membership_changed') {
                    currentUser = {
                        ...currentUser,
                        is_it_member: !!data.notification.is_it_member
                    };
                    localStorage.setItem('user', JSON.stringify(currentUser));
                    updateUserMenuVisibility();
                    refreshCurrentUserProfile();
                    loadConversations();
                }
                showNotificationToast(data.notification);
            } else if (data.type === 'task_chat_unread') {
                const taskId = Number(data.task_id);
                const count = Number(data.unread_count || 0);
                if (!Number.isNaN(taskId) && !Number.isNaN(count)) {
                    const key = getTaskChatKey(taskId);
                    const previousCount = taskChatUnread.get(key) || 0;
                    taskChatUnread.set(key, count);
                    updateTaskChatBadge(key);
                    reorderHelpdeskContainerToTop(taskId);
                    refreshHelpdeskContainerList();
                    const panel = document.getElementById(`taskChatPanel_${taskId}`);
                    const isOpen = panel && panel.classList.contains('open');
                    if (!isOpen && count > previousCount) {
                        showNotificationToast({
                            title: 'New Task Chat Message',
                            body: `Task #${taskId} has unread messages.`
                        });
                    }
                }
            } else if (data.type === 'helpdesk_work_status') {
                helpdeskWorkStatusCache = data.status || {};
                renderHelpdeskWorkStatusModal();
            } else if (data.type === 'it_membership_list_changed') {
                refreshCurrentUserProfile();
                loadConversations();
            }
        };

        notificationSocket.onerror = (error) => {
            console.error('WebSocket error:', error);
            console.log('WebSocket server may not be running. Check server status.');
            notificationSocketConnected = false;
            if (wsConnectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
                showToast('Notifications socket failed to connect. Please reload the page.', 'warning');
            }
            // Only retry if not max attempts reached
            if (wsConnectionAttempts < MAX_CONNECTION_ATTEMPTS) {
                setTimeout(connectNotificationSocket, RETRY_DELAY);
            }
        };

        notificationSocket.onclose = () => {
            console.log('WebSocket connection closed');
            notificationSocketConnected = false;
            // Only retry if not max attempts reached
            if (wsConnectionAttempts < MAX_CONNECTION_ATTEMPTS) {
                setTimeout(connectNotificationSocket, RETRY_DELAY);
            }
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error);
        console.log('WebSocket functionality will be disabled for this session.');
        // Only retry if not max attempts reached
        if (wsConnectionAttempts < MAX_CONNECTION_ATTEMPTS) {
            setTimeout(connectNotificationSocket, RETRY_DELAY);
        }
    }
}

// Handle new message from WebSocket
function handleNewMessage(message) {
    const container = document.getElementById('messagesContainer');
    const msgElement = createMessageElement({
        ...message,
        is_self: message.sender_id === currentUser.id
    });
    container.appendChild(msgElement);
    container.scrollTop = container.scrollHeight;

    // Update conversation list
    loadConversations();

    // Show notification if not from self
    if (message.sender_id !== currentUser.id) {
        // Play notification sound
        playNotificationSound();

        // Show notification toast
        const senderName = message.sender_full_name || message.sender_username || 'Someone';
        const messagePreview = message.content ? message.content.substring(0, 50) : `[${message.message_type}]`;

        showNotificationToast({
            title: senderName,
            body: messagePreview + (message.content && message.content.length > 50 ? '...' : '')
        });
    }
}

// Handle typing indicator
function handleTypingIndicator(data) {
    const indicator = document.getElementById('typingIndicator');
    const text = document.getElementById('typingText');

    if (data.is_typing && data.user_id !== currentUser.id) {
        text.textContent = `${data.username} is typing...`;
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

// Handle message read
function handleMessageRead(data) {
    const msgElement = document.querySelector(`[data-message-id="${data.message_id}"]`);
    if (msgElement) {
        const statusElement = msgElement.querySelector('.message-status');
        if (statusElement) {
            statusElement.innerHTML = '<i class="fas fa-check-double" style="color: #53bdeb;"></i>';
        }
    }
}

// Handle message deleted
function handleMessageDeleted(data) {
    const msgElement = document.querySelector(`[data-message-id="${data.message_id}"]`);
    if (msgElement) {
        if (data.delete_for_everyone || data.user_id === currentUser.id) {
            msgElement.remove();
        }
    }
}

// Handle message edited
function handleMessageEdited(data) {
    const msgElement = document.querySelector(`[data-message-id="${data.message.id}"]`);
    if (msgElement) {
        const newElement = createMessageElement({
            ...data.message,
            is_self: data.message.sender_id === currentUser.id
        });
        msgElement.replaceWith(newElement);
    }
}


// Handle typing
function handleTyping() {
    sendTypingStatus(true);

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        sendTypingStatus(false);
    }, 1000);
}




// Handle broadcast file selection
document.getElementById('broadcastFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById('broadcastFilePreview');

    if (file) {
        preview.innerHTML = `
            <div class="file-info">
                <i class="fas fa-file"></i>
                <span>${file.name}</span>
                <button type="button" onclick="clearBroadcastFile()">&times;</button>
            </div>
        `;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }
});

// Clear broadcast file
function clearBroadcastFile() {
    document.getElementById('broadcastFile').value = '';
    document.getElementById('broadcastFilePreview').style.display = 'none';
}

// Send broadcast message
document.getElementById('sendBroadcastBtn').addEventListener('click', async () => {
    const message = document.getElementById('broadcastMessage').value.trim();
    const fileInput = document.getElementById('broadcastFile');
    const file = fileInput.files[0];

    if (!message && !file) {
        alert('Please enter a message or select a file');
        return;
    }

    if (!confirm('Send this message to all chats? This cannot be undone.')) {
        return;
    }

    try {
        const formData = new FormData();
        if (message) {
            formData.append('content', message);
            formData.append('message_type', 'text');
        }
        if (file) {
            formData.append('media', file);
            formData.append('message_type', 'media');
        }

        const response = await fetch('/api/messaging/broadcast/', {
            method: 'POST',
            headers: {
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            // Clear form
            document.getElementById('broadcastMessage').value = '';
            clearBroadcastFile();
            closeModal('broadcastModal');

            // Reload conversations
            await loadConversations();

            // If in conversation, reload messages
            if (currentConversation) {
                await loadMessages(currentConversation.id);
            }

            alert('Message sent to all chats!');
        } else {
            alert('Error sending message: ' + (data.error || 'Unknown error'));
        }

    } catch (error) {
        console.error('Error sending broadcast:', error);
        alert('Error sending message: ' + error.message);
    }
});

// Send typing status
function sendTypingStatus(isTyping) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            type: 'typing',
            is_typing: isTyping
        }));
    }
}

// Handle file upload
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentConversation) {
        if (!file) {
            showToast('Please select a file', 'error');
        }
        if (!currentConversation) {
            showToast('Please select a conversation first', 'error');
        }
        event.target.value = '';
        return;
    }

    // Check file size. Images are compressed on the server before storage.
    const maxSize = 3 * 1024 * 1024; // 3MB in bytes
    const maxImageSize = 10 * 1024 * 1024; // 10MB before compression
    const isImage = file.type && file.type.startsWith('image/');
    if ((!isImage && file.size > maxSize) || (isImage && file.size > maxImageSize)) {
        const limitText = isImage ? '10MB before compression' : '3MB';
        showToast(`File size must be less than or equal to ${limitText}. Current size: ${formatFileSize(file.size)}`, 'error');
        event.target.value = '';
        return;
    }

    // Show confirmation dialog with file details
    showConfirmDialog(
        'Send File',
        `Send "${file.name}" (${formatFileSize(file.size)})?\n\nImages will be compressed before storage.`,
        () => {
            // User confirmed - continue with upload
            uploadFile(file, event);
        }
    );

    // Reset file input since we're handling it asynchronously
    event.target.value = '';
    return;
}

// Separate function to handle actual file upload
async function uploadFile(file, originalEvent) {
    // Show uploading message
    showToast('Uploading file...', 'info');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversation_id', currentConversation.id);
    formData.append('message_type', getFileType(file.type));
    formData.append('content', ''); // Empty content for file messages

    try {
        const response = await fetch('/api/messaging/upload-media/', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            showToast('File sent successfully', 'success');
            if (currentConversation) {
                loadMessages(currentConversation.id);
            }
        } else {
            showToast('Failed to send file: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        showToast('Failed to send file', 'error');
    }
    // Reset file input
    originalEvent.target.value = '';
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Toggle emoji picker
function toggleEmojiPicker() {
    console.log('Toggle emoji picker called');
    const picker = document.getElementById('emojiPicker');
    console.log('Emoji picker element:', picker);
    if (picker) {
        const currentDisplay = picker.style.display;
        console.log('Current display:', currentDisplay);
        picker.style.display = currentDisplay === 'none' ? 'block' : 'none';
        console.log('New display:', picker.style.display);
    } else {
        console.error('Emoji picker element not found');
    }
}

// Handle emoji selection
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('emoji')) {
        const input = document.getElementById('messageInput');
        input.value += e.target.textContent;
        input.focus();
        document.getElementById('emojiPicker').style.display = 'none';
    }

    // Close emoji picker if clicking outside
    const picker = document.getElementById('emojiPicker');
    const emojiBtn = document.getElementById('emojiBtn');
    if (!picker.contains(e.target) && e.target !== emojiBtn) {
        picker.style.display = 'none';
    }
});

// Get file type
function getFileType(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return 'file';
}

// Load users for new chat
async function loadUsers() {
    const search = document.getElementById('userSearchInput').value;
    try {
        const response = await fetch(`/api/auth/users/?search=${search}`);
        const data = await response.json();

        const usersList = document.getElementById('usersList');
        usersList.innerHTML = '';

        data.users.forEach(user => {
            const userElement = createUserElement(user);
            usersList.appendChild(userElement);
        });
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Create user element
function createUserElement(user) {
    const div = document.createElement('div');
    div.className = 'user-item';
    div.dataset.userId = user.id;

    const profilePic = user.profile_picture || '';
    const picHtml = profilePic
        ? `<img src="${profilePic}" alt="${user.username}">`
        : `<div class="user-avatar">${(user.full_name || user.username).charAt(0).toUpperCase()}</div>`;

    div.innerHTML = `
        ${picHtml}
        <div class="user-item-info">
            <div class="user-item-name">${user.full_name || user.username}</div>
            <div class="user-item-status">${user.status}</div>
        </div>
    `;

    div.addEventListener('click', () => startChat(user.id));

    return div;
}

// Broadcast message to all groups
async function broadcastToAll() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();

    if (!content) {
        alert('Please enter a message to broadcast');
        return;
    }

    if (!currentConversation) {
        alert('Please select a conversation first');
        return;
    }

    if (!confirm('Send this message to all groups?')) {
        return;
    }

    try {
        // Get all conversations for the user
        const convResponse = await fetch('/api/messaging/conversations/');
        const convData = await convResponse.json();

        const conversations_data = [];
        for (const conv of convData.conversations) {
            // Skip conversations with superusers or invalid data
            if (!conv.participants || conv.participants.length === 0) {
                continue;
            }

            const otherParticipant = conv.participants.find(p => p.id !== currentUser.id);

            // Skip if no valid participant found
            if (!otherParticipant || !otherParticipant.username) {
                continue;
            }

            // Skip superusers
            if (otherParticipant.is_superuser) {
                continue;
            }

            const name = otherParticipant.username;

            conversations_data.push({
                id: conv.id,
                name: name,
                type: conv.conversation_type,
                unread_count: conv.unread_count || 0,
                last_message: conv.last_message,
                last_message_time: conv.last_message_time
            });
        }

        // Send message to all group conversations
        for (const conv of conversations_data) {
            if (conv.type === 'group') {
                await fetch('/api/messaging/messages/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        conversation_id: conv.id,
                        content: content,
                        message_type: 'text'
                    })
                });
            }
        }

        input.value = '';
        loadConversations();
        if (currentConversation) {
            loadMessages(currentConversation.id);
        }

        alert('Message broadcast to all groups!');

    } catch (error) {
        console.error('Error broadcasting message:', error);
        alert('Error broadcasting message: ' + error.message);
    }
}

// Load users for group
async function loadUsersForGroup() {
    const search = document.getElementById('groupMemberSearch').value;
    try {
        const response = await fetch(`/api/auth/users/?search=${search}`);
        const data = await response.json();

        const usersList = document.getElementById('groupUsersList');
        usersList.innerHTML = '';

        data.users.forEach(user => {
            if (user.id !== currentUser.id && !selectedMembers.includes(user.id)) {
                const userElement = createUserForGroupElement(user);
                usersList.appendChild(userElement);
            }
        });
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Create user element for group
function createUserForGroupElement(user) {
    const div = document.createElement('div');
    div.className = 'user-item';

    div.innerHTML = `
        <div class="user-item-info">
            <div class="user-item-name">${user.full_name || user.username}</div>
            <div class="user-item-status">${user.status}</div>
        </div>
        <button class="icon-btn" onclick="addToGroup(${user.id}, '${user.username}')">
            <i class="fas fa-plus"></i>
        </button>
    `;

    return div;
}

// Add user to group selection
function addToGroup(userId, username) {
    if (!selectedMembers.includes(userId)) {
        selectedMembers.push(userId);

        const selectedMembersDiv = document.getElementById('selectedMembers');
        const tag = document.createElement('div');
        tag.className = 'member-tag';
        tag.dataset.userId = userId;
        tag.innerHTML = `
            ${username}
            <button onclick="removeFromGroup(${userId})">&times;</button>
        `;
        selectedMembersDiv.appendChild(tag);

        loadUsersForGroup();
    }
}

// Remove user from group selection
function removeFromGroup(userId) {
    selectedMembers = selectedMembers.filter(id => id !== userId);
    const tag = document.querySelector(`.member-tag[data-user-id="${userId}"]`);
    if (tag) {
        tag.remove();
    }
    loadUsersForGroup();
}

// Create group
async function createGroup() {
    const name = document.getElementById('groupName').value.trim();
    const description = document.getElementById('groupDescription').value.trim();

    if (!name) {
        alert('Please enter a group name');
        return;
    }

    if (selectedMembers.length === 0) {
        alert('Please add at least one member');
        return;
    }

    try {
        const response = await fetch('/api/messaging/conversations/create/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                conversation_type: 'group',
                participant_ids: selectedMembers,
                group_name: name,
                group_description: description
            })
        });

        const data = await response.json();

        closeModal('newGroupModal');
        openConversation(data.conversation_id);

        // Reset form
        document.getElementById('groupName').value = '';
        document.getElementById('groupDescription').value = '';
        selectedMembers = [];
        document.getElementById('selectedMembers').innerHTML = '';

    } catch (error) {
        console.error('Error creating group:', error);
    }
}

// Show group info
async function showGroupInfo(conversationId) {
    try {
        const response = await fetch(`/api/messaging/conversations/${conversationId}/`);
        const data = await response.json();

        const conv = data.conversation;
        const groupDetails = document.getElementById('groupDetails');

        groupDetails.innerHTML = `
            <div class="group-info-summary">
                <h3>${conv.name}</h3>
                <p>${conv.description || ''}</p>
                ${conv.name !== 'IT' && conv.created_by ? `
                    <p class="group-info-created">
                        <i class="fas fa-user-plus"></i> Created by: ${conv.created_by}
                    </p>
                ` : ''}
            </div>
            <div class="group-info-members">
                <h4>Participants (${conv.participants.length})</h4>
                <div class="group-info-members-list">
                ${conv.participants.map(p => `
                    <div class="user-item">
                        <div class="user-item-info" style="margin-left: 0;">
                            <div class="user-item-name">${p.full_name || p.username}</div>
                        </div>
                        ${conv.can_manage_members && p.username !== conv.created_by ? `
                            <button class="icon-btn" title="Remove member" onclick="removeMemberFromGroup(${conv.id}, ${p.id})">
                                <i class="fas fa-user-minus"></i>
                            </button>
                        ` : ''}
                    </div>
                `).join('')}
                </div>
            </div>
            ${conv.name !== 'IT' ? `
                <div class="group-info-footer">
                    <button onclick="openAddMembersModal(${conv.id})" 
                            style="background: #00a884; color: white; border: none; padding: 10px 20px; 
                                   border-radius: 8px; cursor: pointer; font-size: 14px;">
                        <i class="fas fa-user-plus"></i> Add Members
                    </button>
                </div>
            ` : ''}
        `;

        openModal('groupInfoModal');

    } catch (error) {
        console.error('Error loading group info:', error);
    }
}

// Open add members modal
async function openAddMembersModal(conversationId) {
    try {
        // Load available users (excluding current participants)
        const response = await fetch('/api/auth/users/');
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load users');
        }

        const conversationResponse = await fetch(`/api/messaging/conversations/${conversationId}/`);
        const convData = await conversationResponse.json();
        if (!conversationResponse.ok) {
            throw new Error(convData.error || 'Failed to load group');
        }

        const currentParticipants = convData.conversation.participants.map(p => p.id);
        const availableUsers = data.users.filter(user => !currentParticipants.includes(user.id));

        const modalContent = document.getElementById('addMembersContent');
        modalContent.innerHTML = `
            <div class="add-members-panel">
                <div class="add-members-list">
                    ${availableUsers.length === 0 ? `
                        <div class="user-checkbox-item">No users available to add.</div>
                    ` : availableUsers.map(user => `
                    <div class="user-checkbox-item">
                        <input type="checkbox" id="user-${user.id}" value="${user.id}">
                        <label for="user-${user.id}">
                            <div class="user-item-info">
                                <div class="user-item-name">${user.full_name || user.username}</div>
                            </div>
                        </label>
                    </div>
                `).join('')}
                </div>
                <div class="add-members-footer">
                    <button type="button" class="btn-secondary" onclick="closeModal('addMembersModal')">
                    Cancel
                </button>
                    <button type="button" class="btn-primary" onclick="addMembersToGroup(${conversationId})" ${availableUsers.length === 0 ? 'disabled' : ''}>
                    Add Members
                </button>
                </div>
            </div>
        `;

        openModal('addMembersModal');

    } catch (error) {
        console.error('Error opening add members modal:', error);
        showToast('Error loading users', 'error');
    }
}

// Add members to group
async function addMembersToGroup(conversationId) {
    try {
        const checkboxes = document.querySelectorAll('#addMembersContent input[type="checkbox"]:checked');
        const userIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

        if (userIds.length === 0) {
            showToast('Please select at least one user', 'warning');
            return;
        }

        const response = await fetch(`/api/messaging/conversations/${conversationId}/add-participants/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ participant_ids: userIds })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showToast('Members added successfully', 'success');
            closeModal('addMembersModal');
            // Refresh group info
            showGroupInfo(conversationId);
            // Refresh conversations list
            loadConversations();
        } else {
            showToast(data.error || 'Failed to add members', 'error');
        }

    } catch (error) {
        console.error('Error adding members:', error);
        showToast('Error adding members', 'error');
    }
}

async function removeMemberFromGroup(conversationId, participantId) {
    if (!confirm('Remove this user from the group?')) {
        return;
    }

    try {
        const response = await fetch(`/api/messaging/conversations/${conversationId}/remove-participant/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({ participant_id: participantId })
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to remove member');
        }

        showToast('Member removed successfully', 'success');
        showGroupInfo(conversationId);
        loadConversations();
    } catch (error) {
        console.error('Error removing member:', error);
        showToast(error.message || 'Error removing member', 'error');
    }
}

// Show context menu
function showContextMenu(event, message) {
    event.preventDefault();

    const contextMenu = document.getElementById('contextMenu');
    contextMenu.style.display = 'block';
    contextMenu.style.left = `${event.pageX}px`;
    contextMenu.style.top = `${event.pageY}px`;

    // Store message data
    contextMenu.dataset.messageId = message.id;
    contextMenu.dataset.isSelf = message.is_self;

    // Show/hide options based on message ownership
    document.getElementById('editBtn').style.display = message.is_self ? 'flex' : 'none';
    document.getElementById('deleteForAllBtn').style.display = message.is_self ? 'flex' : 'none';

    // Setup click handlers
    document.getElementById('replyBtn').onclick = () => replyToMessage(message.id);
    document.getElementById('editBtn').onclick = () => editMessage(message.id);
    document.getElementById('deleteForMeBtn').onclick = () => deleteMessage(message.id, false);
    document.getElementById('deleteForAllBtn').onclick = () => deleteMessage(message.id, true);
}

// Hide context menu
function hideContextMenu() {
    document.getElementById('contextMenu').style.display = 'none';
}

// Reply to message
function replyToMessage(messageId) {
    const input = document.getElementById('messageInput');
    input.placeholder = `Replying to message...`;
    input.dataset.replyTo = messageId;
    input.focus();
    hideContextMenu();
}

// Edit message
function editMessage(messageId) {
    const msgElement = document.querySelector(`[data-message-id="${messageId}"]`);
    const content = msgElement.querySelector('.message-content').textContent;

    const newContent = prompt('Edit message:', content);
    if (newContent && newContent !== content) {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({
                type: 'edit_message',
                message_id: messageId,
                content: newContent
            }));
        }
    }
    hideContextMenu();
}

// Delete message
async function deleteMessage(messageId, deleteForEveryone) {
    if (confirm(deleteForEveryone ? 'Delete for everyone?' : 'Delete for you?')) {
        try {
            const response = await fetch('/api/messaging/delete-message/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message_id: messageId,
                    delete_for_everyone: deleteForEveryone
                })
            });

            if (response.ok) {
                // Remove message from UI
                const msgElement = document.querySelector(`[data-message-id="${messageId}"]`);
                if (msgElement) {
                    msgElement.remove();
                }
                loadConversations();
            } else {
                alert('Error deleting message');
            }
        } catch (error) {
            console.error('Error deleting message:', error);
            alert('Error deleting message: ' + error.message);
        }
    }
    hideContextMenu();
}

// Mark messages as read
async function markMessagesAsRead(conversationId) {
    try {
        console.log('Marking messages as read for conversation:', conversationId);
        const response = await fetch('/api/messaging/mark-read/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ conversation_id: conversationId })
        });
        const data = await response.json();
        console.log('Mark read response:', data);
        // Reload conversations to update unread count
        loadConversations();
    } catch (error) {
        console.error('Error marking messages as read:', error);
    }
}

// Handle search
async function handleSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) {
        loadConversations();
        return;
    }

    try {
        const response = await fetch(`/api/messaging/search/?q=${encodeURIComponent(query)}&type=all`);
        const data = await response.json();

        // Display search results
        displaySearchResults(data.results);
    } catch (error) {
        console.error('Error searching:', error);
    }
}

// Display search results
function displaySearchResults(results) {
    const conversationsList = document.getElementById('conversationsList');
    conversationsList.innerHTML = '';

    if (results.users && results.users.length > 0) {
        const usersHeader = document.createElement('div');
        usersHeader.style.padding = '12px 16px';
        usersHeader.style.color = '#8696a0';
        usersHeader.style.fontSize = '12px';
        usersHeader.textContent = 'Users';
        conversationsList.appendChild(usersHeader);

        results.users.forEach(user => {
            const userElement = createUserElement(user);
            conversationsList.appendChild(userElement);
        });
    }

    if (results.conversations && results.conversations.length > 0) {
        const convsHeader = document.createElement('div');
        convsHeader.style.padding = '12px 16px';
        convsHeader.style.color = '#8696a0';
        convsHeader.style.fontSize = '12px';
        convsHeader.textContent = 'Conversations';
        conversationsList.appendChild(convsHeader);

        results.conversations.forEach(conv => {
            const convElement = createConversationElement(conv);
            conversationsList.appendChild(convElement);
        });
    }

    if (results.messages && results.messages.length > 0) {
        const msgsHeader = document.createElement('div');
        msgsHeader.style.padding = '12px 16px';
        msgsHeader.style.color = '#8696a0';
        msgsHeader.style.fontSize = '12px';
        msgsHeader.textContent = 'Messages';
        conversationsList.appendChild(msgsHeader);

        results.messages.forEach(msg => {
            const msgElement = document.createElement('div');
            msgElement.className = 'conversation-item';
            msgElement.innerHTML = `
                <div class="conversation-info">
                    <div class="conversation-name-row">
                        <span class="conversation-name">${msg.sender}</span>
                        <span class="conversation-time">${new Date(msg.created_at).toLocaleDateString()}</span>
                    </div>
                    <div class="conversation-last-message">${msg.content}</div>
                </div>
            `;
            msgElement.addEventListener('click', () => loadConversation(msg.conversation_id));
            conversationsList.appendChild(msgElement);
        });
    }
}

// Show notification toast
function showNotificationToast(notification) {
    const title = notification && notification.title ? notification.title : 'Notification';
    const body = notification && notification.body ? notification.body : '';
    const toast = document.getElementById('notificationToast');
    const toastTitle = document.getElementById('toastTitle');
    const toastBody = document.getElementById('toastBody');

    if (toast && toastTitle && toastBody) {
        toastTitle.textContent = title;
        toastBody.textContent = body;
        toast.style.display = 'flex';

        setTimeout(hideNotificationToast, 5000);
    }

    sendSystemNotification(title, body);
    playNotificationSound();
}

// Hide notification toast
function hideNotificationToast() {
    const toast = document.getElementById('notificationToast');
    if (toast) {
        toast.style.display = 'none';
    }
}

// Request notification permission
function requestNotificationPermission() {
    if (isElectronApp() || !('Notification' in window)) {
        return;
    }

    const askPermission = () => {
        if (Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
    };

    // Browsers expect notification permission to be requested from a user gesture.
    document.addEventListener('click', askPermission, { once: true });
    document.addEventListener('keydown', askPermission, { once: true });
}

function sendSystemNotification(title, body) {
    if (sendDesktopNotification(title, body)) {
        return;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }

    new Notification(title || 'Notification', {
        body: body || '',
        icon: '/static/img/logo.png',
        badge: '/static/img/logo.png'
    });
}

function sendDesktopNotification(title, body) {
    if (!isElectronApp()) {
        return false;
    }

    if (window && typeof window.postMessage === 'function') {
        window.postMessage({
            type: 'desktop-notification',
            title: title || 'Notification',
            body: body || ''
        }, '*');
        return true;
    }

    return false;
}

// Play notification sound
function playNotificationSound() {
    try {
        // Try to play the notification sound file
        const audio = new Audio('/static/sounds/notification.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {
            // If audio file not available, create a simple beep using Web Audio API
            playBeepSound();
        });
    } catch (error) {
        // Fallback: create a simple beep sound using Web Audio API
        playBeepSound();
    }
}

// Create a simple beep sound using Web Audio API
function playBeepSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.frequency.value = 800; // Frequency in Hz
        oscillator.type = 'sine';

        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
        // Audio context not available, silently fail
        console.debug('Audio notification not available');
    }
}

// Logout
async function logout() {
    try {
        await fetch('/api/auth/logout/', { method: 'POST' });
        localStorage.removeItem('user');

        if (websocket) websocket.close();
        if (notificationSocket) notificationSocket.close();

        window.location.href = '/login/';
    } catch (error) {
        console.error('Error logging out:', error);
    }
}

// Modal functions
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Utility functions
function formatTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

    // For messages older than 24 hours, show date and time
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Check if it's today
    if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Check if it's yesterday
    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // For older messages, show date and time
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Help Desk Container Functions
function loadHelpDeskContainers() {
    if (!currentConversation || !currentConversation.is_help_desk) {
        return;
    }

    fetch('/api/messaging/helpdesk/containers/', {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
        .then(response => response.json())
        .then(data => {
            currentIsItMember = !!data.is_it_member;
            displayHelpDeskContainers(data.containers, data.is_it_member);
            const helpdeskWorkStatusBtn = document.getElementById('helpdeskWorkStatusBtn');
            if (helpdeskWorkStatusBtn) {
                helpdeskWorkStatusBtn.style.display = currentIsItMember ? 'block' : 'none';
            }
        })
        .catch(error => {
            console.error('Error loading help desk containers:', error);
        });
}

function displayHelpDeskContainers(containers, isItMember) {
    currentHelpDeskContainers = containers;
    currentIsItMember = isItMember;
    const helpdeskContainers = document.getElementById('helpdeskContainers');
    const containersList = document.getElementById('containersList');
    const messageInputArea = document.getElementById('messageInputArea');
    const raiseRequestBtn = document.getElementById('raiseRequestBtn');
    const messagesContainer = document.getElementById('messagesContainer');

    if (!helpdeskContainers || !containersList) return;

    // Hide regular messages container and show help desk containers
    if (messagesContainer) {
        messagesContainer.style.display = 'none';
    }
    helpdeskContainers.style.display = 'flex';

    // Hide regular message input for IT help desk group (for all users)
    messageInputArea.style.display = 'none';
    if (!isItMember) {
        raiseRequestBtn.style.display = 'block';
    } else {
        raiseRequestBtn.style.display = 'none';
    }

    setupHelpdeskFilterButtons(isItMember);
    updateHelpdeskFilterButtonLabels(containers, isItMember);
    const filteredContainers = containers.filter(container => helpDeskContainerMatchesFilter(container));

    // Clear existing containers
    containersList.innerHTML = '';
    updateHelpdeskFilterButtons();

    if (filteredContainers.length === 0) {
        containersList.innerHTML = `
            <div class="no-containers">
                <i class="fas fa-inbox"></i>
                <p>${containers.length === 0 ? 'No help desk requests yet.' : 'No requests match the selected status.'}</p>
                ${containers.length === 0 ? '<p>Click "Raise a Request" to create your first request.</p>' : ''}
            </div>
        `;
        return;
    }

    filteredContainers.forEach(container => {
        const containerElement = createContainerElement(container, isItMember);
        containersList.appendChild(containerElement);
    });

    // Ensure we have live task-chat sockets for all containers so unread updates
    // arrive in real-time even when panels are closed (only for IT members).
    connectAllTaskChats();
}

function setHelpdeskFilter(status) {
    currentHelpDeskFilter = status;
    updateHelpdeskFilterButtons();
    updateHelpdeskFilterButtonLabels(currentHelpDeskContainers, currentIsItMember);
    const filteredContainers = currentHelpDeskContainers.filter(container => helpDeskContainerMatchesFilter(container));
    renderHelpDeskContainers(filteredContainers, currentIsItMember);
}

function filterHelpdeskByDate() {
    const fromDateInput = document.getElementById('helpdeskFromDate');
    const toDateInput = document.getElementById('helpdeskToDate');
    
    helpdeskFromDate = fromDateInput ? fromDateInput.value : null;
    helpdeskToDate = toDateInput ? toDateInput.value : null;
    
    updateHelpdeskFilterButtonLabels(currentHelpDeskContainers, currentIsItMember);
    const filteredContainers = currentHelpDeskContainers.filter(container => helpDeskContainerMatchesFilter(container));
    renderHelpDeskContainers(filteredContainers, currentIsItMember);
}

function setupHelpdeskFilterButtons(isItMember) {
    const itOnlyButtons = document.querySelectorAll('.status-filter-btn.it-only');
    itOnlyButtons.forEach(btn => {
        btn.style.display = isItMember ? 'inline-flex' : 'none';
    });

    const allTookOverButton = document.querySelector('.status-filter-btn[data-status="all_took_over"]');
    const allCompletedButton = document.querySelector('.status-filter-btn[data-status="all_completed"]');
    if (allTookOverButton) {
        allTookOverButton.textContent = isItMember ? 'All Took Over' : 'Took Over';
    }
    if (allCompletedButton) {
        allCompletedButton.textContent = isItMember ? 'All Completed' : 'Completed';
    }
}

function getHelpdeskFilterCount(containers, status) {
    return containers.filter(container => {
        // Check status
        let statusMatches = false;
        switch (status) {
            case 'pending':
                statusMatches = container.status === 'pending';
                break;
            case 'took_over':
            case 'all_took_over':
                statusMatches = container.status === 'took_over';
                break;
            case 'completed':
            case 'all_completed':
                statusMatches = container.status === 'completed';
                break;
            case 'my_took_over':
                statusMatches = container.status === 'took_over' && isContainerTakenByCurrentUser(container);
                break;
            case 'my_completed':
                statusMatches = container.status === 'completed' && isContainerTakenByCurrentUser(container);
                break;
            default:
                statusMatches = true;
        }
        
        if (!statusMatches) return false;
        
        // Check date filter
        if (helpdeskFromDate || helpdeskToDate) {
            const containerDate = new Date(container.created_at);
            if (helpdeskFromDate) {
                const fromDate = new Date(helpdeskFromDate);
                fromDate.setHours(0, 0, 0, 0);
                if (containerDate < fromDate) return false;
            }
            if (helpdeskToDate) {
                const toDate = new Date(helpdeskToDate);
                toDate.setHours(23, 59, 59, 999);
                if (containerDate > toDate) return false;
            }
        }
        
        return true;
    }).length;
}

function getHelpdeskFilterUnreadCount(containers, status) {
    return containers.filter(container => {
        const key = getTaskChatKey(container.container_id);
        // Consider both live unread map and initial server-provided unread count
        const liveUnread = Number(taskChatUnread.get(key) || 0);
        const initialUnread = Number(container.task_chat_unread_count || 0);
        const unread = Math.max(liveUnread, initialUnread);
        if (unread <= 0) return false;
        
        // Check status
        let statusMatches = false;
        switch (status) {
            case 'pending':
                statusMatches = container.status === 'pending';
                break;
            case 'took_over':
            case 'all_took_over':
                statusMatches = container.status === 'took_over';
                break;
            case 'completed':
            case 'all_completed':
                statusMatches = container.status === 'completed';
                break;
            case 'my_took_over':
                statusMatches = container.status === 'took_over' && isContainerTakenByCurrentUser(container);
                break;
            case 'my_completed':
                statusMatches = container.status === 'completed' && isContainerTakenByCurrentUser(container);
                break;
            default:
                statusMatches = true;
        }
        
        if (!statusMatches) return false;
        
        // Check date filter
        if (helpdeskFromDate || helpdeskToDate) {
            const containerDate = new Date(container.created_at);
            if (helpdeskFromDate) {
                const fromDate = new Date(helpdeskFromDate);
                fromDate.setHours(0, 0, 0, 0);
                if (containerDate < fromDate) return false;
            }
            if (helpdeskToDate) {
                const toDate = new Date(helpdeskToDate);
                toDate.setHours(23, 59, 59, 999);
                if (containerDate > toDate) return false;
            }
        }
        
        return true;
    }).length;
}

function updateHelpdeskFilterButtonLabels(containers, isItMember) {
    const buttonInfo = [
        { status: 'pending', label: 'Pending' },
        { status: 'my_took_over', label: 'Took Over By Me' },
        { status: 'my_completed', label: 'Completed By Me' },
        { status: 'all_took_over', label: isItMember ? 'All Took Over' : 'Took Over' },
        { status: 'all_completed', label: isItMember ? 'All Completed' : 'Completed' },
    ];

    buttonInfo.forEach(({ status, label }) => {
        const button = document.querySelector(`.status-filter-btn[data-status="${status}"]`);
        if (!button) return;
        const count = getHelpdeskFilterCount(containers, status);
        // For IT members hide unread badges on the aggregate "all" buttons;
        // normal users should still see counts there.
        const hideUnreadForAll = isItMember && (status === 'all_took_over' || status === 'all_completed');
        const unreadCount = hideUnreadForAll ? 0 : getHelpdeskFilterUnreadCount(containers, status);
        const labelText = count > 0 ? `${label} (${count})` : label;
        if (unreadCount > 0) {
            button.innerHTML = `${escapeHtml(labelText)} <span class="filter-unread-count">${unreadCount}</span>`;
        } else {
            button.textContent = labelText;
        }
    });
}

function reorderHelpdeskContainerToTop(taskId) {
    const key = String(getTaskChatKey(taskId));
    // If the task chat panel is currently open, do not reorder (user is interacting)
    const panel = document.getElementById(`taskChatPanel_${key}`);
    if (panel && panel.classList.contains('open')) return;

    const index = currentHelpDeskContainers.findIndex(c => String(c.container_id) === key);
    if (index === -1) return;
    const [container] = currentHelpDeskContainers.splice(index, 1);
    currentHelpDeskContainers.unshift(container);
}

function refreshHelpdeskContainerList() {
    const helpdeskContainers = document.getElementById('helpdeskContainers');
    if (!helpdeskContainers || helpdeskContainers.style.display === 'none') return;

    const openTaskIds = Array.from(document.querySelectorAll('.task-chat-inline-panel.open'))
        .map(el => el.id.replace('taskChatPanel_', ''))
        .filter(id => id);

    updateHelpdeskFilterButtonLabels(currentHelpDeskContainers, currentIsItMember);
    const filteredContainers = currentHelpDeskContainers.filter(container => helpDeskContainerMatchesFilter(container));
    renderHelpDeskContainers(filteredContainers, currentIsItMember);

    openTaskIds.forEach(taskId => {
        const panel = document.getElementById(`taskChatPanel_${taskId}`);
        if (!panel) return;
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        ensureTaskChatReady(taskId);
        focusTaskChatInput(taskId);
    });
}

function updateHelpdeskFilterButtons() {
    const buttons = document.querySelectorAll('.status-filter-btn');
    buttons.forEach(btn => {
        if (btn.dataset.status === currentHelpDeskFilter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function isContainerTakenByCurrentUser(container) {
    if (!currentUser || !container.taken_by) {
        return false;
    }
    const takenByUsername = container.taken_by.username || '';
    const takenByFullName = container.taken_by.full_name || '';
    return currentUser.username === takenByUsername || currentUser.full_name === takenByFullName;
}

function helpDeskContainerMatchesFilter(container) {
    // Check status filter
    let statusMatches = false;
    switch (currentHelpDeskFilter) {
        case 'pending':
            statusMatches = container.status === 'pending';
            break;
        case 'took_over':
        case 'all_took_over':
            statusMatches = container.status === 'took_over';
            break;
        case 'completed':
        case 'all_completed':
            statusMatches = container.status === 'completed';
            break;
        case 'my_took_over':
            statusMatches = container.status === 'took_over' && isContainerTakenByCurrentUser(container);
            break;
        case 'my_completed':
            statusMatches = container.status === 'completed' && isContainerTakenByCurrentUser(container);
            break;
        case 'all':
        default:
            statusMatches = true;
    }
    
    if (!statusMatches) return false;
    
    // Check date filter
    if (helpdeskFromDate || helpdeskToDate) {
        const containerDate = new Date(container.created_at);
        if (helpdeskFromDate) {
            const fromDate = new Date(helpdeskFromDate);
            fromDate.setHours(0, 0, 0, 0);
            if (containerDate < fromDate) return false;
        }
        if (helpdeskToDate) {
            const toDate = new Date(helpdeskToDate);
            toDate.setHours(23, 59, 59, 999);
            if (containerDate > toDate) return false;
        }
    }
    
    return true;
}

function createContainerElement(container, isItMember) {
    const div = document.createElement('div');
    div.className = `helpdesk-container ${container.status}`;
    div.dataset.containerId = container.container_id;

    const statusText = container.status.replace('_', ' ').toUpperCase();
    const createdDate = new Date(container.created_at).toLocaleString();
    const takenByText = container.taken_by ? `${container.taken_by.full_name || container.taken_by.username}` : '';
    const requesterName = container.requester.full_name || container.requester.username;
    const isTakenByCurrentUser = currentUser && container.taken_by && 
        ((container.taken_by.username && currentUser.username === container.taken_by.username) ||
         (container.taken_by.full_name && currentUser.full_name === container.taken_by.full_name));

    div.innerHTML = `
        <div class="container-header">
            <div class="container-id-main">Task #${container.container_id}</div>
            <div class="container-header-actions">
                <button class="task-chat-toggle-inline" type="button" title="Task chat" onclick="toggleTaskChat(${container.container_id})">
                    <i class="fas fa-comment-dots"></i>
                    <span class="task-chat-badge" id="taskChatBadge_${container.container_id}" style="display:none;">0</span>
                </button>
                <div class="status-badge-main ${container.status}">${statusText}</div>
            </div>
        </div>
        
        <div class="container-body">
            <div class="message-section">
                <div class="message-header-section">
                    <div class="sender-info">
                        <span class="sender-name">${requesterName}</span>
                        <span class="message-time">${createdDate}</span>
                    </div>
                </div>
                
                <div class="message-content-section">
                    <div class="problem-description">${container.problem_description || 'No description provided'}</div>
                    
                    ${container.attached_files || takenByText || isItMember && (container.status === 'pending' || container.status === 'took_over') ? `
                <div class="single-line-container">
                    ${container.attached_files ? `
                        <div class="attachment-container">
                            <div class="attachment-header">
                                <i class="fas fa-paperclip"></i>
                                <span>Attachment</span>
                            </div>
                            <div class="attachment-content">
                                <div class="attachment-link media-file"
                                     data-file-url="${container.attached_files}"
                                     data-file-name="${container.file_name || ''}"
                                     data-message-type="file"
                                     style="cursor: pointer;">
                                    <i class="fas fa-paperclip"></i>
                                    ${container.file_name || 'View Attachment'}
                                </div>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${takenByText ? `
                        <div class="assignment-container">
                            <div class="assignment-header">
                                <i class="fas fa-user-check"></i>
                                <span>Took By</span>
                            </div>
                            <div class="assignment-content">
                                <span class="assigned-user">${takenByText}</span>
                            </div>
                        </div>
                    ` : ''}
                    
                    ${isItMember && (container.status === 'pending' || (container.status === 'took_over' && isTakenByCurrentUser)) ? `
                        <div class="action-container">
                            ${container.status === 'pending' ?
                    `<button class="action-btn-primary take-over-btn" onclick="takeOverContainer(${container.container_id})">
                                    <i class="fas fa-hand-paper"></i>
                                    Take Over Request
                                </button>` :
                    `<button class="action-btn-success complete-btn" onclick="completeContainer(${container.container_id})">
                                    <i class="fas fa-check-circle"></i>
                                    Mark as Completed
                                </button>`
                }
                        </div>
                    ` : ''}
                </div>
            ` : ''}
                    
                </div>
            </div>

            <div class="task-chat-inline-panel" id="taskChatPanel_${container.container_id}" aria-hidden="true">
                <div class="task-chat-header">
                    <div class="task-chat-title">
                        <i class="fas fa-comments"></i>
                        <span>Task Chat</span>
                    </div>
                    <button class="task-chat-close" type="button" title="Close" onclick="toggleTaskChat(${container.container_id}, false)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="task-chat-messages" id="taskChatMessages_${container.container_id}">
                    <div class="task-chat-loading">Loading...</div>
                </div>
                <div class="task-chat-composer" id="taskChatComposer_${container.container_id}" style="display:none;">
                    <input class="task-chat-input" id="taskChatInput_${container.container_id}" type="text" placeholder="Message...">
                    <button class="task-chat-send" type="button" title="Send" onclick="sendTaskChatMessage(${container.container_id})">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
                <div class="task-chat-readonly" id="taskChatReadonly_${container.container_id}" style="display:none;">
                    Read-only
                </div>
            </div>

        </div>
    `;

    const badge = div.querySelector('.task-chat-badge');
    const key = getTaskChatKey(container.container_id);
    let initialUnread = 0;

    if (taskChatUnread.has(key)) {
        initialUnread = Number(taskChatUnread.get(key) || 0);
    } else if (taskChatUnreadPending.has(key)) {
        initialUnread = Number(taskChatUnreadPending.get(key) || 0);
        taskChatUnreadPending.delete(key);
    } else {
        initialUnread = Number(container.task_chat_unread_count || 0);
    }

    if (!Number.isNaN(initialUnread)) {
        taskChatUnread.set(key, initialUnread);
        if (badge) {
            if (initialUnread > 0) {
                badge.textContent = String(initialUnread);
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    return div;
}

// ---- Task Container Chat (Help Desk) ----
// Separate from individual/private chats. Room: task_chat_<task_id>
const taskChatSockets = new Map(); // taskId -> WebSocket
const taskChatCanSend = new Map(); // taskId -> boolean
const taskChatUnread = new Map(); // taskId -> count
const taskChatUnreadPending = new Map(); // taskId -> count when badge node not rendered yet
let helpdeskWorkStatusCache = null; // { members: [{username, full_name, active_tasks:[ids]}] } OR {username: {...}}
let pendingCompleteContainerId = null;

function getTaskChatKey(taskId) {
    return String(taskId);
}

function getTaskChatWsUrl(taskId) {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.host}/ws/task-chat/${taskId}/`;
}

function closeAllTaskChatsExcept(taskId) {
    document.querySelectorAll('.task-chat-inline-panel.open').forEach(panel => {
        const id = panel.id.replace('taskChatPanel_', '');
        if (id !== String(taskId)) {
            panel.classList.remove('open');
            panel.setAttribute('aria-hidden', 'true');
        }
    });
}

async function fetchWorkStatus() {
    try {
        const resp = await fetch('/api/messaging/helpdesk/work-status/', {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to load work status');
        helpdeskWorkStatusCache = data.status || data;
    } catch (e) {
        console.warn('fetchWorkStatus failed', e);
        helpdeskWorkStatusCache = { error: e.message || 'Failed to load' };
    }
}

// ---- Fixed Problem Modal (Complete Task) ----
function askFixedProblemModal(onSubmit) {
    const modal = document.getElementById('fixedProblemModal');
    const textArea = document.getElementById('fixedProblemText');
    const error = document.getElementById('fixedProblemError');
    const closeBtn = document.getElementById('fixedProblemClose');
    const cancelBtn = document.getElementById('fixedProblemCancel');
    const submitBtn = document.getElementById('fixedProblemSubmit');

    if (!modal || !textArea || !error || !closeBtn || !cancelBtn || !submitBtn) {
        // Hard fallback
        const fixedProblem = window.prompt('What did you fix? (Required)', '');
        if (fixedProblem && fixedProblem.trim()) onSubmit(fixedProblem.trim());
        return;
    }

    textArea.value = '';
    error.textContent = '';
    error.style.display = 'none';
    modal.style.display = 'flex';
    setTimeout(() => textArea.focus(), 50);

    const closeModal = () => {
        modal.style.display = 'none';
    };

    const submit = () => {
        const fixedProblem = (textArea.value || '').trim();
        if (!fixedProblem) {
            error.textContent = 'Please enter what was fixed before completing this task.';
            error.style.display = 'block';
            textArea.focus();
            return;
        }
        closeModal();
        onSubmit(fixedProblem);
    };

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    submitBtn.onclick = submit;
    modal.onclick = (event) => {
        if (event.target === modal) closeModal();
    };
}

// ---- Global Helpdesk Work Status Modal ----
function toggleHelpdeskWorkStatusModal(forceOpen = null) {
    const modal = document.getElementById('helpdeskWorkStatusModal');
    const closeBtn = document.getElementById('helpdeskWorkStatusClose');
    if (!modal) return;

    const isOpen = modal.style.display === 'flex';
    const shouldOpen = forceOpen === null ? !isOpen : !!forceOpen;

    if (shouldOpen) {
        modal.style.display = 'flex';
        ensureHelpdeskWorkStatusModalReady();
        if (closeBtn) closeBtn.onclick = () => toggleHelpdeskWorkStatusModal(false);
        modal.onclick = (e) => { if (e.target === modal) toggleHelpdeskWorkStatusModal(false); };
    } else {
        modal.style.display = 'none';
    }
}

async function ensureHelpdeskWorkStatusModalReady() {
    if (!helpdeskWorkStatusCache) {
        await fetchWorkStatus();
    }
    renderHelpdeskWorkStatusModal();
}

function renderHelpdeskWorkStatusModal() {
    const body = document.getElementById('helpdeskWorkStatusBody');
    if (!body) return;

    const status = helpdeskWorkStatusCache;
    if (!status) {
        body.innerHTML = '<div style="color:#9aa6b2; font-size:12px; text-align:center;">Loading...</div>';
        return;
    }
    if (status.error) {
        body.innerHTML = `<div style="color:#ef4444; font-size:12px; text-align:center;">${escapeHtml(status.error)}</div>`;
        return;
    }

    const members = status.members || status.it_members || [];
    if (!Array.isArray(members) || members.length === 0) {
        body.innerHTML = '<div style="color:#9aa6b2; font-size:12px; text-align:center;">No status available.</div>';
        return;
    }

    body.innerHTML = members.map(m => {
        const name = escapeHtml(m.full_name || m.username || 'Member');
        const active = Array.isArray(m.active_tasks) ? m.active_tasks : [];
        const activeText = active.length ? `Working on Task ${active.join(', ')}` : 'No Active Tasks';
        return `
            <div class="work-status-row">
                <div class="work-status-name">${name}</div>
                <div class="work-status-activity">${escapeHtml(activeText)}</div>
            </div>
        `;
    }).join('');
}

function toggleTaskChat(taskId, forceOpen = null) {
    const panel = document.getElementById(`taskChatPanel_${taskId}`);
    if (!panel) return;

    const shouldOpen = forceOpen === null ? !panel.classList.contains('open') : !!forceOpen;

    if (shouldOpen) {
        closeAllTaskChatsExcept(taskId);
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        markTaskChatRead(taskId);
        ensureTaskChatReady(taskId);
        focusTaskChatInput(taskId);
    } else {
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
        disconnectTaskChat(taskId);
    }
}

async function markTaskChatRead(taskId) {
    const key = getTaskChatKey(taskId);
    // Optimistic badge clear, plus persist read state server-side.
    taskChatUnread.set(key, 0);
    updateTaskChatBadge(key);
    refreshHelpdeskContainerList();
    try {
        await fetch(`/api/messaging/helpdesk/task-chat/${taskId}/mark-read/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
                'X-CSRFToken': getCookie('csrftoken'),
            },
        });
    } catch (e) {
        // Non-fatal; badge will still behave locally.
        console.warn('markTaskChatRead failed', e);
    }
}

function focusTaskChatInput(taskId) {
    const input = document.getElementById(`taskChatInput_${taskId}`);
    if (input && input.offsetParent !== null) {
        setTimeout(() => input.focus(), 50);
    }
}

function updateTaskChatBadge(taskId) {
    const key = getTaskChatKey(taskId);
    const badge = document.getElementById(`taskChatBadge_${key}`);
    if (!badge) {
        taskChatUnreadPending.set(key, Number(taskChatUnread.get(key) || 0));
        return;
    }
    
    // Always hide badge if panel is open
    const panel = document.getElementById(`taskChatPanel_${key}`);
    if (panel && panel.classList.contains('open')) {
        badge.style.display = 'none';
        return;
    }
    
    const count = taskChatUnread.get(key) || 0;
    if (count > 0) {
        badge.textContent = String(count);
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

async function ensureTaskChatReady(taskId) {
    // Load history + permission first (REST), then open WS for realtime.
    await loadTaskChatHistory(taskId);
    connectTaskChat(taskId);
    wireTaskChatEnterToSend(taskId);
}

function wireTaskChatEnterToSend(taskId) {
    const input = document.getElementById(`taskChatInput_${taskId}`);
    if (!input || input.dataset.boundEnter === '1') return;
    input.dataset.boundEnter = '1';
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendTaskChatMessage(taskId);
        }
    });
}

async function loadTaskChatHistory(taskId) {
    const messagesEl = document.getElementById(`taskChatMessages_${taskId}`);
    const composerEl = document.getElementById(`taskChatComposer_${taskId}`);
    const readonlyEl = document.getElementById(`taskChatReadonly_${taskId}`);
    if (!messagesEl) return;

    messagesEl.innerHTML = '<div class="task-chat-loading">Loading...</div>';
    try {
        const response = await fetch(`/api/messaging/helpdesk/task-chat/${taskId}/messages/`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
            }
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load task chat messages');
        }

        const canSend = !!data.can_send;
        taskChatCanSend.set(getTaskChatKey(taskId), canSend);

        composerEl.style.display = canSend ? 'flex' : 'none';
        readonlyEl.style.display = canSend ? 'none' : 'block';

        messagesEl.innerHTML = '';
        const msgs = data.messages || [];
        taskChatCanSend.set(getTaskChatKey(taskId), canSend);
        if (msgs.length === 0) {
            messagesEl.innerHTML = '<div class="task-chat-empty">No messages yet.</div>';
        } else {
            msgs.forEach(msg => {
                messagesEl.appendChild(createTaskChatMessageElement(msg));
            });
        }
        scrollTaskChatToBottom(taskId);
    } catch (err) {
        console.error('Task chat load error:', err);
        messagesEl.innerHTML = `<div class="task-chat-error">${escapeHtml(err.message || 'Error loading task chat')}</div>`;
        if (composerEl) composerEl.style.display = 'none';
        if (readonlyEl) readonlyEl.style.display = 'none';
    }
}

function connectTaskChat(taskId) {
    const key = getTaskChatKey(taskId);
    if (taskChatSockets.has(key)) return;

    const ws = new WebSocket(getTaskChatWsUrl(taskId));
    taskChatSockets.set(key, ws);

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'task_chat_message' && data.message) {
                onTaskChatMessage(taskId, data.message);
            } else if (data.type === 'error') {
                console.warn('Task chat error:', data.error);
            }
        } catch (e) {
            console.error('Task chat parse error:', e);
        }
    };

    ws.onclose = () => {
        taskChatSockets.delete(getTaskChatKey(taskId));
    };

    ws.onerror = (e) => {
        console.error('Task chat ws error:', e);
    };
}

// Connect task-chat sockets for all current helpdesk containers (IT members only)
function connectAllTaskChats() {
    if (!currentIsItMember || !Array.isArray(currentHelpDeskContainers)) return;
    currentHelpDeskContainers.forEach(container => {
        const id = getTaskChatKey(container.container_id);
        // connectTaskChat already guards against duplicate connections
        connectTaskChat(id);
    });
}

function disconnectTaskChat(taskId) {
    const key = getTaskChatKey(taskId);
    const ws = taskChatSockets.get(key);
    if (ws) {
        try { ws.close(); } catch (_) {}
    }
    taskChatSockets.delete(key);
}

function onTaskChatMessage(taskId, msg) {
    const key = getTaskChatKey(taskId);
    const messagesEl = document.getElementById(`taskChatMessages_${taskId}`);
    const isSelf = msg && currentUser && msg.sender_id === currentUser.id;

    // If panel is closed, increment unread badge.
    const panel = document.getElementById(`taskChatPanel_${taskId}`);
    const isOpen = panel && panel.classList.contains('open');
    if (!isOpen && !isSelf) {
        taskChatUnread.set(key, (taskChatUnread.get(key) || 0) + 1);
        updateTaskChatBadge(key);
        // Move container to top so it is visible immediately
        reorderHelpdeskContainerToTop(taskId);
        refreshHelpdeskContainerList();

        // Show a toast/notification for IT helpdesk
        showNotificationToast({
            title: 'Task Chat',
            body: `Task #${taskId} has a new message.`
        });
        return;
    }
    if (!messagesEl) return;

    // Remove empty state if present.
    const empty = messagesEl.querySelector('.task-chat-empty');
    if (empty) empty.remove();

    messagesEl.appendChild(createTaskChatMessageElement({
        ...msg,
        is_self: isSelf,
    }));
    scrollTaskChatToBottom(taskId);
}

function sendTaskChatMessage(taskId) {
    const canSend = taskChatCanSend.get(getTaskChatKey(taskId));
    if (!canSend) return;

    const input = document.getElementById(`taskChatInput_${taskId}`);
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;

    const key = getTaskChatKey(taskId);
    const ws = taskChatSockets.get(key);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Try reconnect once
        disconnectTaskChat(taskId);
        connectTaskChat(taskId);
    }

    const ws2 = taskChatSockets.get(key);
    if (!ws2 || ws2.readyState !== WebSocket.OPEN) {
        showNotification('Error', 'Task chat connection is not ready. Please try again.', 'error');
        return;
    }

    ws2.send(JSON.stringify({
        type: 'task_chat_message',
        message: text,
    }));

    input.value = '';
    focusTaskChatInput(taskId);
}

function createTaskChatMessageElement(msg) {
    const wrap = document.createElement('div');
    const isSelf = !!msg.is_self;
    wrap.className = `task-chat-message ${isSelf ? 'self' : 'other'}`;

    const sender = escapeHtml(msg.sender_full_name || msg.sender_username || 'Someone');
    const time = formatTaskChatTime(msg.timestamp);
    const body = escapeHtml(msg.message || '');

    wrap.innerHTML = `
        <div class="task-chat-bubble">
            <div class="task-chat-meta">
                <span class="task-chat-sender">${sender}</span>
                <span class="task-chat-time">${time}</span>
            </div>
            <div class="task-chat-text">${body}</div>
        </div>
    `;
    return wrap;
}

function formatTaskChatTime(isoTs) {
    try {
        const d = new Date(isoTs);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString();
    } catch (_) {
        return '';
    }
}

function scrollTaskChatToBottom(taskId) {
    const el = document.getElementById(`taskChatMessages_${taskId}`);
    if (!el) return;
    el.scrollTop = el.scrollHeight;
}

function takeOverContainer(containerId) {
    if (!confirm('Are you sure you want to take over this request?')) {
        return;
    }

    fetch(`/api/messaging/helpdesk/take-over/${containerId}/`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'X-CSRFToken': getCookie('csrftoken')
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Success', data.message, 'success');
                loadHelpDeskContainers(); // Refresh the containers
            } else {
                showNotification('Error', data.error || 'Failed to take over container', 'error');
            }
        })
        .catch(error => {
            console.error('Error taking over container:', error);
            showNotification('Error', 'Failed to take over container', 'error');
        });
}

function completeContainer(containerId) {
    if (!confirm('Are you sure you want to mark this request as completed?')) return;

    askFixedProblemModal((fixedProblemTrim) => {
        fetch(`/api/messaging/helpdesk/complete/${containerId}/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'X-CSRFToken': getCookie('csrftoken'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fixed_problem: fixedProblemTrim })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification('Success', data.message, 'success');
                    loadHelpDeskContainers(); // Refresh the containers
                } else {
                    showNotification('Error', data.error || 'Failed to complete container', 'error');
                }
            })
            .catch(error => {
                console.error('Error completing container:', error);
                showNotification('Error', 'Failed to complete container', 'error');
            });
    });
}

function openHelpDeskRequestModal() {
    const modal = document.getElementById('helpdeskRequestModal');
    if (modal) {
        modal.style.display = 'flex';
        // Reset form
        document.getElementById('problemDescription').value = '';
        document.getElementById('attachedFile').value = '';
        document.getElementById('filePreview').style.display = 'none';
    }
}

function closeHelpDeskRequestModal() {
    const modal = document.getElementById('helpdeskRequestModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function submitHelpDeskRequest() {
    const problemDescription = document.getElementById('problemDescription').value.trim();
    const attachedFile = document.getElementById('attachedFile').files[0];

    if (!problemDescription) {
        showNotification('Error', 'Please describe your problem', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('problem_description', problemDescription);
    if (attachedFile) {
        formData.append('attached_file', attachedFile);
    }

    fetch('/api/messaging/helpdesk/container/', {
        method: 'POST',
        headers: {
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: formData
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Success', 'Help desk request created successfully', 'success');
                closeHelpDeskRequestModal();
                loadHelpDeskContainers(); // Refresh the containers
            } else {
                showNotification('Error', data.error || 'Failed to create request', 'error');
            }
        })
        .catch(error => {
            console.error('Error creating help desk request:', error);
            showNotification('Error', 'Failed to create request', 'error');
        });
}

// File preview for help desk request
document.addEventListener('DOMContentLoaded', () => {
    const attachedFile = document.getElementById('attachedFile');
    const filePreview = document.getElementById('filePreview');

    if (attachedFile && filePreview) {
        attachedFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                filePreview.innerHTML = `<i class="fas fa-file"></i> ${file.name}`;
                filePreview.style.display = 'flex';
            } else {
                filePreview.style.display = 'none';
            }
        });
    }

    // Help desk request modal event listeners
    const raiseRequestBtn = document.getElementById('raiseRequestBtn');
    if (raiseRequestBtn) {
        raiseRequestBtn.addEventListener('click', openHelpDeskRequestModal);
    }

    const closeHelpdeskRequestModal = document.getElementById('closeHelpdeskRequestModal');
    if (closeHelpdeskRequestModal) {
        closeHelpdeskRequestModal.addEventListener('click', closeHelpDeskRequestModal);
    }

    const cancelHelpdeskRequest = document.getElementById('cancelHelpdeskRequest');
    if (cancelHelpdeskRequest) {
        cancelHelpdeskRequest.addEventListener('click', closeHelpDeskRequestModal);
    }

    const submitHelpdeskRequest = document.getElementById('submitHelpdeskRequest');
    if (submitHelpdeskRequest) {
        submitHelpdeskRequest.addEventListener('click', submitHelpDeskRequest);
    }
});
// Change Password functionality
function showChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
}

function closeChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
    document.getElementById('changePasswordForm')?.reset();
}

// Initialize change password form
document.addEventListener('DOMContentLoaded', () => {
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (newPassword !== confirmPassword) {
                if (typeof showToast === 'function') {
                    showToast('New passwords do not match', 'error');
                } else {
                    alert('New passwords do not match');
                }
                return;
            }

            try {
                const response = await fetch('/api/auth/change-password/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify({
                        current_password: currentPassword,
                        new_password: newPassword,
                        confirm_password: confirmPassword
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    if (typeof showToast === 'function') {
                        showToast('Password changed successfully', 'success');
                    } else {
                        alert('Password changed successfully');
                    }
                    closeChangePasswordModal();
                } else {
                    if (typeof showToast === 'function') {
                        showToast(data.error || 'Failed to change password', 'error');
                    } else {
                        alert(data.error || 'Failed to change password');
                    }
                }
            } catch (error) {
                console.error('Error changing password:', error);
                if (typeof showToast === 'function') {
                    showToast('An error occurred. Please try again.', 'error');
                } else {
                    alert('An error occurred. Please try again.');
                }
            }
        });
    }

    // Close modal when clicking outside
    const changePasswordModal = document.getElementById('changePasswordModal');
    if (changePasswordModal) {
        changePasswordModal.addEventListener('click', (e) => {
            if (e.target === changePasswordModal) {
                closeChangePasswordModal();
            }
        });
    }
});

// Handle in-chat search
function handleInChatSearch() {
    const query = document.getElementById('inChatSearchInput').value.trim().toLowerCase();

    // Check if we are in IT Help Desk
    const helpdeskContainers = document.getElementById('helpdeskContainers');
    if (helpdeskContainers && helpdeskContainers.style.display !== 'none') {
        const filtered = currentHelpDeskContainers.filter(c => {
            const id = (c.container_id || c.id || '').toString().toLowerCase();
            const desc = (c.problem_description || '').toLowerCase();
            const requester = (c.requester && (typeof c.requester === 'object' ? c.requester.username : c.requester) || '').toLowerCase();
            const matchesQuery = !query || id.includes(query) || desc.includes(query) || requester.includes(query);
            const matchesFilter = helpDeskContainerMatchesFilter(c);
            return matchesQuery && matchesFilter;
        });
        renderHelpDeskContainers(filtered, currentIsItMember);
    } else {
        // Filter messages in normal chat
        const messages = document.querySelectorAll('.message-item');
        messages.forEach(msg => {
            const contentElement = msg.querySelector('.message-content');
            if (contentElement) {
                const content = contentElement.textContent.toLowerCase();
                if (content.includes(query)) {
                    msg.style.display = 'flex';
                } else {
                    msg.style.display = 'none';
                }
            }
        });
    }
}

// Helper to render containers without updating globals
function renderHelpDeskContainers(containers, isItMember) {
    const containersList = document.getElementById('containersList');
    if (!containersList) return;

    containersList.innerHTML = '';

    if (containers.length === 0) {
        containersList.innerHTML = '<div class="no-containers"><i class="fas fa-search"></i><p>No matching requests found</p></div>';
        return;
    }

    containers.forEach(container => {
        const containerElement = createContainerElement(container, isItMember);
        containersList.appendChild(containerElement);
    });

    // Ensure all badges are properly updated after rendering
    containers.forEach(container => {
        updateTaskChatBadge(container.container_id);
    });
}
