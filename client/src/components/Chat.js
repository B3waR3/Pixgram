import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import io from 'socket.io-client';
import './Chat.css';
import axios from 'axios';

function Chat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [friends, setFriends] = useState([]);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [socket, setSocket] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversations, setConversations] = useState([]);
  const messagesEndRef = useRef(null);
  const selectedFriendRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editText, setEditText] = useState('');

  // Initialize socket connection
  useEffect(() => {
    if (user) {
      console.log('🔌 Initializing socket connection for user:', user.id);
      const newSocket = io('http://localhost:5000', {
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        timeout: 20000,
        forceNew: true
      });
      
      newSocket.on('connect', () => {
        console.log('✅ Socket connected successfully:', newSocket.id);
        const userId = user._id || user.id;
        console.log('🏠 Joining user room:', `user-${userId}`);
        newSocket.emit('join-user-room', userId);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('❌ Socket disconnected:', reason);
      });

      newSocket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error);
      });

      newSocket.on('reconnect', (attemptNumber) => {
        console.log('🔄 Socket reconnected after', attemptNumber, 'attempts');
      });

      newSocket.on('reconnect_error', (error) => {
        console.error('❌ Socket reconnection error:', error);
      });

      // Listen for room joining confirmation
      newSocket.on('room-joined', (data) => {
        console.log('🏠✅ Successfully joined room:', data);
      });

      // Listen for new messages from Chats database
      newSocket.on('new-message', (messageData) => {
        console.log('📨 Received new message via socket:', messageData);
        console.log('📨 Current user ID:', user._id || user.id);
        console.log('📨 Selected friend ID:', selectedFriendRef.current?.id);
        console.log('📨 Message senderId:', messageData.senderId);
        console.log('📨 Message receiverId:', messageData.receiverId);
        
        // Add message to current conversation if it's related to the current user
        const currentUserId = (user._id || user.id).toString();
        const messageSenderId = messageData.senderId.toString();
        const messageReceiverId = messageData.receiverId.toString();
        
        const isForCurrentUser = messageReceiverId === currentUserId || messageSenderId === currentUserId;
        
        if (isForCurrentUser) {
          console.log('📨 Message is for current user, processing...');
          
          // Check if this message belongs to the currently active conversation
          const currentSelectedFriend = selectedFriendRef.current;
          const selectedFriendId = currentSelectedFriend?.id?.toString();
          const isForActiveConversation = selectedFriendId && (
            (messageSenderId === currentUserId && messageReceiverId === selectedFriendId) ||
            (messageSenderId === selectedFriendId && messageReceiverId === currentUserId)
          );
          
          console.log('📨 Is for active conversation?', isForActiveConversation, {
            selectedFriendId,
            messageSenderId,
            messageReceiverId,
            currentUserId,
            hasSelectedFriend: !!currentSelectedFriend
          });
          
          // Always update messages state, but only if it's for the active conversation OR no conversation is selected
          if (isForActiveConversation || !currentSelectedFriend) {
          setMessages(prev => {
            // Check if message already exists (to prevent duplicates)
              const messageExists = prev.some(msg => 
                msg._id && messageData._id && msg._id.toString() === messageData._id.toString()
              );
              
            if (messageExists) {
                console.log('📨 Message already exists, skipping duplicate');
              return prev;
            }
            
              console.log('📨 Adding new message to active conversation');
              const newMessage = {
              _id: messageData._id,
              senderId: messageData.senderId,
              senderName: messageData.senderName,
              receiverId: messageData.receiverId,
              receiverName: messageData.receiverName,
                content: messageData.message || messageData.content,
                createdAt: messageData.timestamp || messageData.createdAt,
              isRead: messageData.isRead
              };
              
              // Check if this is replacing an optimistic message (same content, same sender)
              const optimisticIndex = prev.findIndex(msg => 
                msg.isOptimistic && 
                msg.senderId === newMessage.senderId && 
                msg.content === newMessage.content
              );
              
              if (optimisticIndex !== -1) {
                console.log('📨 Replacing optimistic message with real message');
                const updatedMessages = [...prev];
                updatedMessages[optimisticIndex] = newMessage; // Replace optimistic with real
                return updatedMessages;
              } else {
                console.log('📨 Adding new message (no optimistic to replace)');
                return [...prev, newMessage];
              }
            });
          } else {
            console.log('📨 Message not for active conversation, only updating conversations list');
        }

          // Always update conversations list to reflect new message
          setTimeout(() => {
            loadConversations();
          }, 100);
        } else {
          console.log('📨 Message not for current user, ignoring');
        }
      });

      newSocket.on('message-confirmed', (data) => {
        console.log('✅ Message confirmed:', data);
      });

      newSocket.on('message-error', (error) => {
        console.error('❌ Socket message error:', error);
        alert('Failed to send message: ' + error.error);
      });

      // Listen for message edits
      newSocket.on('message-edited', (data) => {
        console.log('✏️ Received message edit:', data);
        const { messageId, newContent, editedAt } = data;
        
        setMessages(prev => prev.map(msg => 
          msg._id === messageId 
            ? { ...msg, content: newContent, editedAt: editedAt }
            : msg
        ));
      });

      // Listen for message deletions
      newSocket.on('message-deleted', (data) => {
        console.log('🗑️ Received message deletion:', data);
        const { messageId } = data;
        
        setMessages(prev => prev.filter(msg => msg._id !== messageId));
      });



      setSocket(newSocket);

      return () => {
        console.log('🔌 Cleaning up socket connection');
        newSocket.disconnect();
      };
    }
  }, [user]);

    // Handle URL parameters for auto-selecting a chat
  useEffect(() => {
    const userId = searchParams.get('userId');
    console.log('🔍 Chat component checking URL userId:', userId);
    console.log('🔍 Available friends:', friends);
    
    if (userId && friends.length > 0) {
      // Find the friend in the friends list
      const friendToSelect = friends.find(friend => friend.id === userId);
      console.log('🔍 Found friend to select:', friendToSelect);
      
      if (friendToSelect && (!selectedFriend || selectedFriend.id !== userId)) {
        console.log('🎯 Auto-selecting friend from URL:', friendToSelect);
        selectFriend(friendToSelect);
        // Clear the URL parameter after selecting
        setSearchParams({});
      }
    }
   }, [searchParams, friends, selectedFriend]);

  // 1. Load friends first
  useEffect(() => {
    if (user) {
      loadFriends();
    }
  }, [user]);

  // 2. Load conversations after friends
  useEffect(() => {
    if (user && friends.length > 0) {
      loadConversations();
    }
  }, [user, friends]);

  // 3. Merge for display
  const getDisplayList = () => {
    // Map friends to display items
    return friends.map(friend => {
      const conv = conversations.find(c => c.otherUserId === friend.id);
      return {
        id: friend.id,
        name: friend.name,
        lastMessage: conv ? conv.lastMessage.content : 'No messages yet',
        lastMessageTime: conv ? conv.lastMessage.createdAt : null,
        unreadCount: conv ? conv.unreadCount : 0,
        isConversation: !!conv
      };
    });
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Keep selectedFriendRef in sync with selectedFriend state
  useEffect(() => {
    selectedFriendRef.current = selectedFriend;
  }, [selectedFriend]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenu(null);
    };

    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadFriends = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/friends', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.data.success) {
        setFriends(
          (response.data.friends || []).map(u => ({
            id: u._id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username,
            username: u.username,
            firstName: u.firstName,
            lastName: u.lastName
          }))
        );
      }
    } catch (error) {
      console.error('Error loading friends:', error);
    }
  };

  const loadConversations = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/messages/conversations', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.data.success) {
        setConversations(response.data.conversations || []);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const loadConversation = async (friendId) => {
    if (!friendId) return;
    
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      console.log(`📖 Loading conversation with user ${friendId} from Chats DB`);
      
      const response = await axios.get(`/api/messages/conversation/${friendId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.data.success) {
        const data = response.data;
        console.log(`📖 Loaded ${data.messages.length} messages from Chats DB:`, data.messages);
        
        // Convert messages to expected format
        const formattedMessages = data.messages.map(msg => ({
          _id: msg._id,
          senderId: msg.senderId,
          senderName: msg.senderName,
          receiverId: msg.receiverId,
          receiverName: msg.receiverName,
          content: msg.content,
          createdAt: msg.createdAt,
          isRead: msg.isRead
        }));
        
        setMessages(formattedMessages);
      } else {
        console.error('Failed to load conversation');
        setMessages([]);
      }
    } catch (error) {
      console.error('Error loading conversation:', error);
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  const selectFriend = (friend) => {
    console.log('👤 Selected friend:', friend);
    setSelectedFriend(friend);
    selectedFriendRef.current = friend; // Update ref as well
    loadConversation(friend.id);
    // Note: Messages are automatically marked as read in loadConversation server endpoint
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) {
      console.warn('⚠️ Empty message, not sending');
      return;
    }
    
    if (!selectedFriend) {
      console.warn('⚠️ No friend selected, not sending');
      return;
    }
    
    if (!socket) {
      console.error('❌ Socket not connected, cannot send message');
      alert('Not connected to chat server. Please refresh the page.');
      return;
    }

    if (!socket.connected) {
      console.error('❌ Socket disconnected, cannot send message');
      alert('Disconnected from chat server. Please refresh the page.');
      return;
    }

    console.log('🔍 DEBUG - User object:', user);
    console.log('🔍 DEBUG - User ID:', user.id);
    console.log('🔍 DEBUG - User _ID:', user._id);
    console.log('🔍 DEBUG - Selected friend:', selectedFriend);
    console.log('🔍 DEBUG - Selected friend ID:', selectedFriend.id);
    console.log('🔍 DEBUG - Socket connected:', socket.connected);
    console.log('🔍 DEBUG - Socket ID:', socket.id);

    // Construct full name from firstName and lastName
    const senderName = user.firstName && user.lastName 
      ? `${user.firstName} ${user.lastName}` 
      : user.username || 'Unknown User';

    const messageData = {
      senderId: user._id || user.id,
      receiverId: selectedFriend.id,
      message: newMessage.trim(),
      senderName: senderName,
      receiverName: selectedFriend.name
    };

    console.log('📤 Sending message via socket to Chats DB:', messageData);
    console.log('🔍 DEBUG - Message data types:', {
      senderIdType: typeof messageData.senderId,
      receiverIdType: typeof messageData.receiverId,
      senderId: messageData.senderId,
      receiverId: messageData.receiverId,
      socketConnected: socket.connected
    });

    try {
      // Add optimistic update - show message immediately
      const optimisticMessage = {
        _id: `temp_${Date.now()}`, // Temporary ID
        senderId: messageData.senderId,
        senderName: messageData.senderName,
        receiverId: messageData.receiverId,
        receiverName: messageData.receiverName,
        content: messageData.message,
        createdAt: new Date(),
        isRead: false,
        isOptimistic: true // Mark as optimistic update
      };

      console.log('📤 Adding optimistic message for immediate feedback');
      setMessages(prev => [...prev, optimisticMessage]);

      // Send via socket (will save to Chats database)
      console.log('📡 Emitting send-message event...');
      socket.emit('send-message', messageData);

      // Clear the input immediately
      setNewMessage('');
      
      console.log('📤 Message sent successfully, waiting for real-time confirmation...');
      
    } catch (error) {
      console.error('❌ Error sending message:', error);
      alert(`Failed to send message: ${error.message}`);
      
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => !msg.isOptimistic || msg.content !== messageData.message));
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Handle long press / right click on messages
  const handleMessageLongPress = (message, event) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Only show context menu for messages sent by current user
    const currentUserId = (user._id || user.id).toString();
    if (message.senderId.toString() !== currentUserId) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX || rect.right;
    const clickY = event.clientY || rect.top;
    
    // Check viewport dimensions to prevent menu from going off-screen
    const menuWidth = 200; // Approximate menu width
    const menuHeight = 120; // Approximate menu height
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Adjust X position if menu would go off right edge
    let adjustedX = clickX;
    if (clickX + menuWidth > viewportWidth) {
      adjustedX = clickX - menuWidth; // Position to the left of cursor
    }
    
    // Adjust Y position if menu would go off bottom edge
    let adjustedY = clickY;
    if (clickY + menuHeight > viewportHeight) {
      adjustedY = clickY - menuHeight; // Position above cursor
    }
    
    // Ensure menu doesn't go off left or top edges
    adjustedX = Math.max(10, adjustedX);
    adjustedY = Math.max(10, adjustedY);

    setContextMenu({
      message,
      x: adjustedX,
      y: adjustedY
    });
  };

  // Handle edit message
  const handleEditMessage = (message) => {
    setEditingMessage(message._id);
    setEditText(message.content);
    setContextMenu(null);
  };

  // Save edited message
  const saveEditedMessage = async (messageId) => {
    if (!editText.trim()) return;

    try {
      const token = localStorage.getItem('token');
      const requestData = {
        content: editText.trim(),
        otherUserId: selectedFriend.id
      };
      
      console.log('🔍 EDIT REQUEST DATA:', {
        messageId,
        requestData,
        url: `http://localhost:5000/api/messages/edit/${messageId}`,
        hasToken: !!token
      });
      
      const response = await axios.put(`/api/messages/edit/${messageId}`, requestData, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.data.success) {
        // Update local messages
        setMessages(prev => prev.map(msg => 
          msg._id === messageId 
            ? { ...msg, content: editText.trim(), editedAt: new Date() }
            : msg
        ));
        
        // Emit socket event for real-time update
        if (socket) {
          socket.emit('message-edited', {
            messageId,
            newContent: editText.trim(),
            senderId: user._id || user.id,
            receiverId: selectedFriend.id,
            editedAt: new Date()
          });
        }
        
        console.log('✅ Message edited successfully');
      } else {
        const errorData = response.data;
        console.error('❌ Failed to edit message:', response.status, errorData);
        alert(`Failed to edit message: ${response.status} ${errorData.message}`);
      }
    } catch (error) {
      console.error('❌ Error editing message:', error);
      alert('Error editing message');
    }

    setEditingMessage(null);
    setEditText('');
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingMessage(null);
    setEditText('');
  };

  // Handle delete message
  const handleDeleteMessage = async (message) => {
    if (!window.confirm('Are you sure you want to delete this message?')) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await axios.delete(`/api/messages/${message._id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        data: {
          otherUserId: selectedFriend.id
        }
      });

      if (response.data.success) {
        // Remove message from local state
        setMessages(prev => prev.filter(msg => msg._id !== message._id));
        
        // Emit socket event for real-time update
        if (socket) {
          socket.emit('message-deleted', {
            messageId: message._id,
            senderId: user._id || user.id,
            receiverId: selectedFriend.id
          });
        }
        
        console.log('✅ Message deleted successfully');
      } else {
        console.error('❌ Failed to delete message');
        alert('Failed to delete message');
      }
    } catch (error) {
      console.error('❌ Error deleting message:', error);
      alert('Error deleting message');
    }

    setContextMenu(null);
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="chat-container">
      <div className="chat-sidebar">
        <div className="chat-header">
          <h3>💬 Chats</h3>
          <small>Powered by Chats Database</small>
        </div>
        
        <div className="friends-list">
          {getDisplayList().map((item) => (
            <div
              key={item.id}
              className={`friend-item ${selectedFriend?.id === item.id ? 'active' : ''}`}
              onClick={() => selectFriend(item)}
            >
              <div className="friend-info">
                <div 
                  className="friend-name clickable" 
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/dashboard?tab=friends&userId=${item.id}`);
                  }}
                >
                  {item.name}
                  {item.unreadCount > 0 && (
                    <span className="unread-badge">{item.unreadCount}</span>
                  )}
                </div>
                <div className="friend-last-message">
                  {item.lastMessage}
                </div>
                {item.lastMessageTime && (
                  <div className="friend-last-time">
                    {formatTime(item.lastMessageTime)}
                  </div>
                )}
              </div>
              <div className="conversation-indicator">
                {item.isConversation ? '💾' : '👤'}
              </div>
            </div>
          ))}
          
          {getDisplayList().length === 0 && (
            <div className="no-friends">
              <p>Loading friends...</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
              
                
                <div style={{ 
                  fontSize: '12px', 
                  color: 'rgba(255,255,255,0.8)', 
                  marginTop: '10px',
                  textAlign: 'center'
                }}>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chat-main">
        {selectedFriend ? (
          <>
            <div className="chat-header">
              <h3>💬 {selectedFriend.name}</h3>
              <small>Messages stored in Chats Database</small>
            </div>

            <div className="messages-container">
              {isLoading ? (
                <div className="loading">Loading messages from Chats DB...</div>
              ) : (
                <>
                  {messages.map((message) => (
                    <div
                      key={message._id}
                      className={`message ${message.senderId === (user._id || user.id) ? 'sent' : 'received'} ${message.isOptimistic ? 'optimistic' : ''}`}
                      onContextMenu={(e) => handleMessageLongPress(message, e)}
                      onTouchStart={(e) => {
                        // Handle mobile long press
                        const touch = e.touches[0];
                        const longPressTimer = setTimeout(() => {
                          handleMessageLongPress(message, {
                            preventDefault: () => {},
                            stopPropagation: () => {},
                            currentTarget: e.currentTarget,
                            clientX: touch.clientX,
                            clientY: touch.clientY
                          });
                        }, 500);
                        
                        const handleTouchEnd = () => {
                          clearTimeout(longPressTimer);
                          document.removeEventListener('touchend', handleTouchEnd);
                        };
                        
                        document.addEventListener('touchend', handleTouchEnd);
                      }}
                    >
                      <div className="message-content">
                        {editingMessage === message._id ? (
                          <div className="message-edit-container">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="message-edit-input"
                              autoFocus
                            />
                            <div className="message-edit-actions">
                              <button 
                                onClick={() => saveEditedMessage(message._id)}
                                className="edit-save-btn"
                              >
                                Save
                              </button>
                              <button 
                                onClick={cancelEditing}
                                className="edit-cancel-btn"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="message-text">
                              {message.content}
                              {message.editedAt && (
                                <span className="edited-indicator"> (edited)</span>
                              )}
                            </div>
                        <div className="message-time">
                          {formatTime(message.createdAt)}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Context Menu */}
            {contextMenu && (
              <div 
                className="message-context-menu"
                style={{
                  position: 'fixed',
                  top: contextMenu.y,
                  left: contextMenu.x,
                  zIndex: 1000
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="context-menu-item" onClick={() => handleEditMessage(contextMenu.message)}>
                  <span className="context-menu-icon">✏️</span>
                  Edit Message
                </div>
                <div className="context-menu-item" onClick={() => handleDeleteMessage(contextMenu.message)}>
                  <span className="context-menu-icon">🗑️</span>
                  Delete Message
                </div>
                <div className="context-menu-item" onClick={() => {
                  navigator.clipboard.writeText(contextMenu.message.content);
                  setContextMenu(null);
                }}>
                  <span className="context-menu-icon">📋</span>
                  Copy Text
                </div>
              </div>
            )}

            <div className="message-input-container">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={`Message ${selectedFriend.name}...`}
                className="message-input"
                rows="2"
              />
              <button 
                onClick={sendMessage} 
                className="send-button"
                disabled={!newMessage.trim()}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="no-chat-selected">
            <h3>Select a friend to start chatting</h3>
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat; 