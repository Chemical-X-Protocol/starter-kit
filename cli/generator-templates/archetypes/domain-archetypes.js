/**
 * Domain & Entity Archetypes: User Profile, Auth Session, Cart & Billing, Chat & Messaging
 */

export const DOMAIN_ARCHETYPES = [
  {
    id: 'user-profile',
    name: 'User Profile & Avatar',
    keywords: ['profile', 'user', 'avatar', 'account', 'author'],
    destructure: 'user, isEditing, status, toggleEdit, updateUser, setStatus',
    buildState: (name, pascal) => `export interface ${pascal}User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl?: string;
}

export interface ${pascal}State {
  readonly user: ${pascal}User | null;
  readonly isEditing: boolean;
  readonly status: 'online' | 'away' | 'offline';
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly initialUser?: { id: string; name: string; email: string; avatarUrl?: string };
  readonly onUpdate?: (user: { id: string; name: string; email: string }) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';
import type { ${pascal}User } from './types';

export const use${pascal}Controller = (options: { initialUser?: ${pascal}User; onUpdate?: (u: ${pascal}User) => void } = {}) => {
  const [user, setUser] = useState<${pascal}User | null>(options.initialUser || {
    id: 'u-1',
    name: 'Alex Mercer',
    email: 'alex.mercer@chemicalx.dev'
  });
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [status, setStatus] = useState<'online' | 'away' | 'offline'>('online');

  const toggleEdit = () => setIsEditing((prev) => !prev);
  const updateUser = (updated: ${pascal}User) => {
    setUser(updated);
    setIsEditing(false);
    options.onUpdate?.(updated);
  };

  return { user, isEditing, status, toggleEdit, updateUser, setStatus };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__profile">
        <div className="${name}__avatar">
          <span>{user?.name?.[0] || 'U'}</span>
          <span className={\`${name}__status-indicator ${name}__status-indicator--\${status}\`} />
        </div>
        <div className="${name}__details">
          <h4>{user?.name}</h4>
          <p>{user?.email}</p>
          <button type="button" onClick={toggleEdit}>{isEditing ? 'Cancel' : 'Edit Profile'}</button>
        </div>
      </div>`
  },
  {
    id: 'auth-session',
    name: 'Auth & Session Gate',
    keywords: ['auth', 'login', 'session', 'gate', 'permission', 'role'],
    destructure: 'isAuthenticated, userId, role, login, logout',
    buildState: (name, pascal) => `export interface ${pascal}State {
  readonly isAuthenticated: boolean;
  readonly userId: string | null;
  readonly role: 'guest' | 'member' | 'admin';
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly onLogin?: (userId: string) => void;
  readonly onLogout?: () => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';

export const use${pascal}Controller = (options: { onLogin?: (id: string) => void; onLogout?: () => void } = {}) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<'guest' | 'member' | 'admin'>('guest');

  const login = (id: string, userRole: 'member' | 'admin' = 'member') => {
    setIsAuthenticated(true);
    setUserId(id);
    setRole(userRole);
    options.onLogin?.(id);
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUserId(null);
    setRole('guest');
    options.onLogout?.();
  };

  return { isAuthenticated, userId, role, login, logout };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__session">
        {isAuthenticated ? (
          <div>
            <span>Signed in as {userId} ({role})</span>
            <button type="button" onClick={logout}>Sign Out</button>
          </div>
        ) : (
          <button type="button" onClick={() => login('u-demo', 'member')}>Sign In</button>
        )}
      </div>`
  },
  {
    id: 'cart-billing',
    name: 'Cart & Billing',
    keywords: ['cart', 'checkout', 'pricing', 'plan', 'invoice', 'subscription', 'billing'],
    destructure: 'items, subtotal, discountCode, setDiscountCode, updateQuantity, checkout',
    buildState: (name, pascal) => `export interface ${pascal}CartItem {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly quantity: number;
}

export interface ${pascal}State {
  readonly items: readonly ${pascal}CartItem[];
  readonly subtotal: number;
  readonly discountCode: string | null;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly initialItems?: readonly { id: string; name: string; price: number; quantity: number }[];
  readonly onCheckout?: (total: number) => void;
}
`,
    buildController: (name, pascal) => `import { useState, useMemo } from 'react';
import type { ${pascal}CartItem } from './types';

export const use${pascal}Controller = (options: { onCheckout?: (total: number) => void } = {}) => {
  const [items, setItems] = useState<readonly ${pascal}CartItem[]>([]);
  const [discountCode, setDiscountCode] = useState<string | null>(null);

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.price * item.quantity, 0), [items]);

  const updateQuantity = (id: string, delta: number) => {
    setItems((prev) =>
      prev
        .map((i: ${pascal}CartItem) => (i.id === id ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
        .filter((i: ${pascal}CartItem) => i.quantity > 0)
    );
  };

  const checkout = () => {
    options.onCheckout?.(subtotal);
  };

  return { items, subtotal, discountCode, setDiscountCode, updateQuantity, checkout };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__cart">
        <h4>Order Summary ({items.length} items)</h4>
        <div className="${name}__total">Subtotal: \${(subtotal / 100).toFixed(2)}</div>
        <button type="button" disabled={items.length === 0} onClick={checkout}>Checkout</button>
      </div>`
  },
  {
    id: 'chat-messaging',
    name: 'Chat & Messaging',
    keywords: ['chat', 'message', 'thread', 'inbox', 'comment', 'feed'],
    destructure: 'messages, draftText, setDraftText, send',
    buildState: (name, pascal) => `export interface ${pascal}Message {
  readonly id: string;
  readonly author: string;
  readonly text: string;
  readonly timestamp: number;
}

export interface ${pascal}State {
  readonly messages: readonly ${pascal}Message[];
  readonly draftText: string;
}
`,
    buildProps: (name, pascal) => `export interface ${pascal}Props {
  readonly initialMessages?: readonly { id: string; author: string; text: string; timestamp: number }[];
  readonly onSend?: (text: string) => void;
}
`,
    buildController: (name, pascal) => `import { useState } from 'react';
import type { ${pascal}Message } from './types';

export const use${pascal}Controller = (options: { onSend?: (text: string) => void } = {}) => {
  const [messages, setMessages] = useState<readonly ${pascal}Message[]>([]);
  const [draftText, setDraftText] = useState<string>('');

  const send = () => {
    if (!draftText.trim()) return;
    const nextMsg: ${pascal}Message = { id: String(Date.now()), author: 'You', text: draftText.trim(), timestamp: Date.now() };
    setMessages((prev) => [...prev, nextMsg]);
    options.onSend?.(draftText.trim());
    setDraftText('');
  };

  return { messages, draftText, setDraftText, send };
};
`,
    buildReactBody: (name, pascal) => `      <div className="${name}__feed">
        {messages.map((m) => (
          <div key={m.id} className="${name}__message">
            <strong>{m.author}</strong>: <span>{m.text}</span>
          </div>
        ))}
      </div>
      <div className="${name}__input-row">
        <input type="text" value={draftText} onChange={(e) => setDraftText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button type="button" onClick={send}>Send</button>
      </div>`
  }
];
