/* ──────────────────────────────────────────────────────────
 *  Admin Panel — user lookup, tag management, account removal
 * ────────────────────────────────────────────────────────── */

import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useConnectionStore } from '../stores/connectionStore';
import {
  useTagStore, ALL_TAGS, TAG_MAP, CATEGORY_LABELS,
  type TagCategory, type TagDef,
} from '../stores/tagStore';
import { useShopStore } from '../stores/shopStore';
import { ArrowLeft, Trash, Shield, Plus } from '../components/Icons';
import { Avatar, Button } from '../components/Shared';
import * as ws from '../net/wsClient';
import './Admin.css';

/* ── Grouped tags by category ──────────────────────────── */
const TAG_GROUPS: { category: TagCategory; tags: TagDef[] }[] = (
  ['staff', 'anniversary', 'holiday', 'seasonal', 'achievement', 'special'] as TagCategory[]
).map(cat => ({ category: cat, tags: ALL_TAGS.filter(t => t.category === cat) }));

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('image_read_failed'));
    reader.readAsDataURL(file);
  });
}

export function AdminPanel() {
  const setScreen = useAuthStore(s => s.setScreen);
  const contacts = useChatStore(s => s.contacts);
  const remoteProfiles = useChatStore(s => s.remoteProfiles);
  const idsUrl = useConnectionStore(s => s.idsUrl);
  const { userTags, giveTag, removeTag, removeUser } = useTagStore();
  const authUserId = useAuthStore(s => s.userId) ?? 'admin';
  const authDisplayName = useAuthStore(s => s.displayName) ?? authUserId;
  const sessionToken = useAuthStore(s => s.sessionToken);
  const listings = useShopStore(s => s.listings);
  const addListing = useShopStore(s => s.addListing);
  const updateListing = useShopStore(s => s.updateListing);
  const removeListing = useShopStore(s => s.removeListing);

  const [query, setQuery] = useState('');
  const [adminTab, setAdminTab] = useState<'users' | 'shop'>('users');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [serverResults, setServerResults] = useState<Array<{ id: string; displayName: string }>>([]);
  const [listingTitle, setListingTitle] = useState('');
  const [listingPrice, setListingPrice] = useState('0');
  const [listingDate, setListingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [listingStock, setListingStock] = useState('1');
  const [listingDescription, setListingDescription] = useState('');
  const [listingImage, setListingImage] = useState('');
  const [editingListingId, setEditingListingId] = useState<string | null>(null);

  /* ── Search server for all users ───────────────────────── */
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setServerResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`${idsUrl}/users/search?q=${encodeURIComponent(query.trim())}`, {
          headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
        });
        const data = await res.json();
        const users = (data.users ?? []).map((u: { userId: string; displayName: string }) => ({
          id: u.userId,
          displayName: u.displayName,
        }));
        setServerResults(users);
        // Request profiles (avatars) for the results
        const userIds = users.map((u: { id: string }) => u.id);
        if (userIds.length > 0) void ws.requestProfiles(userIds);
      } catch {
        setServerResults([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [query, idsUrl]);

  // Merge local contacts with server results so dev-seeded users are visible.
  // Local contacts that match the query and aren't already in serverResults come first.
  const localMatches = query.trim().length >= 2
    ? Object.values(contacts).filter(c => {
        const q = query.trim().toLowerCase();
        return (
          !serverResults.find(r => r.id === c.id) &&
          (c.displayName.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
        );
      }).map(c => ({ id: c.id, displayName: c.displayName }))
    : [];
  const results = [...localMatches, ...serverResults];

  /* ── Selected user info ───────────────────── */
  const selectedUser = selectedUserId
    ? (contacts[selectedUserId] ?? serverResults.find(u => u.id === selectedUserId))
    : null;
  const selectedTags = selectedUserId ? (userTags[selectedUserId] ?? []) : [];

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  function handleToggleTag(tagId: string) {
    if (!selectedUserId) return;
    if (selectedTags.includes(tagId)) {
      removeTag(selectedUserId, tagId);
      ws.sendTagUpdate(selectedUserId, tagId, 'remove');
      flash(`Removed ${TAG_MAP[tagId]?.label}`);
    } else {
      giveTag(selectedUserId, tagId);
      ws.sendTagUpdate(selectedUserId, tagId, 'give');
      flash(`Gave ${TAG_MAP[tagId]?.label}`);
    }
  }

  function handleDeleteUser() {
    if (!confirmDelete) return;
    removeUser(confirmDelete);
    flash(`Account removed`);
    if (selectedUserId === confirmDelete) setSelectedUserId(null);
    setConfirmDelete(null);
  }

  function resetListingForm() {
    setListingTitle('');
    setListingPrice('0');
    setListingDate(new Date().toISOString().slice(0, 10));
    setListingStock('1');
    setListingDescription('');
    setListingImage('');
    setEditingListingId(null);
  }

  function loadListingForEdit(listingId: string) {
    const listing = listings.find((entry) => entry.id === listingId);
    if (!listing) return;
    setEditingListingId(listing.id);
    setListingTitle(listing.title);
    setListingPrice(String(listing.price));
    setListingDate(listing.listedDate);
    setListingStock(String(listing.stock));
    setListingDescription(listing.description);
    setListingImage(listing.imageDataUrl ?? '');
  }

  function handleSaveListing() {
    const title = listingTitle.trim();
    const price = Number(listingPrice);
    const stock = Number(listingStock);
    if (!title || !Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || stock < 0) {
      flash('Provide a valid title, price, and stock.');
      return;
    }

    if (editingListingId) {
      updateListing(editingListingId, {
        title,
        description: listingDescription.trim(),
        price,
        listedDate: listingDate,
        stock,
        imageDataUrl: listingImage || undefined,
      });
      flash('Listing updated.');
    } else {
      addListing({
        title,
        description: listingDescription.trim(),
        price,
        currency: 'USD',
        listedDate: listingDate,
        imageDataUrl: listingImage || undefined,
        sellerId: authUserId,
        sellerName: authDisplayName,
        stock,
      });
      flash('Listing added.');
    }

    resetListingForm();
  }

  return (
    <div className="admin">
      {/* ── Header ─────────────────────────── */}
      <div className="admin__header">
        <button className="admin__back" onClick={() => setScreen('main')}>
          <ArrowLeft size={20} />
        </button>
        <Shield size={20} />
        <h1 className="admin__title">Admin Panel</h1>
        <div className="admin__tabs">
          <button
            className={`admin__tab ${adminTab === 'users' ? 'admin__tab--active' : ''}`}
            onClick={() => setAdminTab('users')}
          >
            Users
          </button>
          <button
            className={`admin__tab ${adminTab === 'shop' ? 'admin__tab--active' : ''}`}
            onClick={() => setAdminTab('shop')}
          >
            Shop
          </button>
        </div>
      </div>

      {adminTab === 'users' && (
      <div className="admin__body">
        {/* ── Left: search + user list ──────── */}
        <div className="admin__sidebar">
          <input
            className="admin__search"
            placeholder="Search by username or ID…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />

          <div className="admin__results">
            {query.trim() && results.length === 0 && (
              <div className="admin__empty">No users found</div>
            )}
            {results.map(user => (
              <button
                key={user.id}
                className={`admin__user-row ${selectedUserId === user.id ? 'admin__user-row--active' : ''}`}
                onClick={() => { setSelectedUserId(user.id); setConfirmDelete(null); }}
              >
                <Avatar name={user.displayName} src={remoteProfiles[user.id]?.avatar ?? undefined} size={32} />
                <div className="admin__user-info">
                  <span className="admin__user-name">{user.displayName}</span>
                  <span className="admin__user-id">{user.id}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: tag management ────────── */}
        <div className="admin__main">
          {!selectedUser ? (
            <div className="admin__placeholder">
              <Shield size={48} />
              <p>Search for a user to manage their tags</p>
            </div>
          ) : (
            <>
              {/* User header */}
              <div className="admin__user-header">
                <Avatar name={selectedUser.displayName} size={48} />
                <div>
                  <h2 className="admin__selected-name">{selectedUser.displayName}</h2>
                  <span className="admin__selected-id">{selectedUserId}</span>
                </div>
                <button
                  className="admin__delete-btn"
                  onClick={() => setConfirmDelete(selectedUserId)}
                  title="Remove account"
                >
                  <Trash size={18} />
                </button>
              </div>

              {/* Confirm delete dialog */}
              {confirmDelete === selectedUserId && (
                <div className="admin__confirm-delete">
                  <span>Permanently remove this account and all their tags?</span>
                  <div className="admin__confirm-actions">
                    <Button variant="danger" size="sm" onClick={handleDeleteUser}>Remove</Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* Current tags */}
              <div className="admin__current-tags">
                <h3>Current Tags ({selectedTags.length})</h3>
                <div className="admin__tag-pills">
                  {selectedTags.length === 0 && (
                    <span className="admin__no-tags">No tags yet</span>
                  )}
                  {selectedTags.map(id => {
                    const tag = TAG_MAP[id];
                    if (!tag) return null;
                    return (
                      <button
                        key={id}
                        className="admin__tag-pill admin__tag-pill--active"
                        style={{ background: tag.color, color: tag.textColor ?? '#fff' }}
                        onClick={() => handleToggleTag(id)}
                        title={`Click to remove ${tag.label}`}
                      >

                        <span>{tag.label}</span>
                        <span className="admin__tag-remove">&times;</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* All tags grouped by category */}
              <div className="admin__all-tags">
                <h3>All Tags</h3>
                {TAG_GROUPS.map(({ category, tags }) => (
                  <div key={category} className="admin__tag-group">
                    <h4 className="admin__tag-category">{CATEGORY_LABELS[category]}</h4>
                    <div className="admin__tag-pills">
                      {tags.map(tag => {
                        const has = selectedTags.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            className={`admin__tag-pill ${has ? 'admin__tag-pill--active' : 'admin__tag-pill--inactive'}`}
                            style={has
                              ? { background: tag.color, color: tag.textColor ?? '#fff' }
                              : { background: 'transparent', borderColor: tag.color, color: tag.color }
                            }
                            onClick={() => handleToggleTag(tag.id)}
                            title={has ? `Remove ${tag.label}` : `Give ${tag.label}`}
                          >
                            <span>{tag.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {adminTab === 'shop' && (
        <div className="admin__shop">
          <section className="admin__shop-form">
            <h2>{editingListingId ? 'Edit Listing' : 'Add Listing'}</h2>
            <div className="admin__shop-form-grid">
              <label>
                Title
                <input value={listingTitle} onChange={e => setListingTitle(e.target.value)} maxLength={80} />
              </label>
              <label>
                Price (USD)
                <input type="number" min="0" step="0.01" value={listingPrice} onChange={e => setListingPrice(e.target.value)} />
              </label>
              <label>
                Date
                <input type="date" value={listingDate} onChange={e => setListingDate(e.target.value)} />
              </label>
              <label>
                Stock
                <input type="number" min="0" step="1" value={listingStock} onChange={e => setListingStock(e.target.value)} />
              </label>
              <label className="admin__shop-form-wide">
                Description
                <textarea rows={3} value={listingDescription} onChange={e => setListingDescription(e.target.value)} maxLength={500} />
              </label>
              <label className="admin__shop-form-wide">
                Product image
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setListingImage(await readImageAsDataUrl(file));
                    } catch {
                      flash('Could not read image file.');
                    }
                  }}
                />
              </label>
            </div>

            {listingImage && <img src={listingImage} alt="Listing preview" className="admin__shop-image" />}

            <div className="admin__shop-form-actions">
              <Button variant="ghost" size="sm" onClick={resetListingForm}>Reset</Button>
              <Button variant="primary" size="sm" onClick={handleSaveListing}>
                <Plus size={14} /> {editingListingId ? 'Update Listing' : 'Publish Listing'}
              </Button>
            </div>
          </section>

          <section className="admin__shop-listings">
            <h2>Storefront Listings ({listings.length})</h2>
            {listings.length === 0 ? (
              <div className="admin__empty">No listings yet.</div>
            ) : (
              <div className="admin__shop-cards">
                {[...listings].sort((a, b) => b.createdAt - a.createdAt).map((listing) => (
                  <article key={listing.id} className="admin__shop-card">
                    <div className="admin__shop-card-media">
                      {listing.imageDataUrl
                        ? <img src={listing.imageDataUrl} alt={listing.title} />
                        : <div className="admin__shop-card-placeholder">No image</div>}
                    </div>
                    <div className="admin__shop-card-body">
                      <div className="admin__shop-card-head">
                        <strong>{listing.title}</strong>
                        <span>${listing.price.toFixed(2)}</span>
                      </div>
                      <p>{listing.description || 'No description provided.'}</p>
                      <div className="admin__shop-card-meta">
                        <span>Seller: {listing.sellerName}</span>
                        <span>Date: {listing.listedDate}</span>
                        <span>Stock: {listing.stock}</span>
                      </div>
                      <div className="admin__shop-card-actions">
                        <Button variant="secondary" size="sm" onClick={() => loadListingForEdit(listing.id)}>Edit</Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            removeListing(listing.id);
                            flash('Listing removed.');
                            if (editingListingId === listing.id) resetListingForm();
                          }}
                        >
                          <Trash size={14} /> Remove
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="admin__toast">{toast}</div>}
    </div>
  );
}
