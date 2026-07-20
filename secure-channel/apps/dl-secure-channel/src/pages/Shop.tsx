import { useMemo, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useShopStore } from '../stores/shopStore';
import { ArrowLeft, Plus, Search, Trash, Shield } from '../components/Icons';
import { Button } from '../components/Shared';
import './Shop.css';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

export function Shop() {
  const setScreen = useAuthStore((s) => s.setScreen);
  const userId = useAuthStore((s) => s.userId) ?? 'unknown-user';
  const displayName = useAuthStore((s) => s.displayName) ?? userId;

  const listings = useShopStore((s) => s.listings);
  const addListing = useShopStore((s) => s.addListing);
  const removeListing = useShopStore((s) => s.removeListing);
  const buyListing = useShopStore((s) => s.buyListing);

  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [showSellForm, setShowSellForm] = useState(false);

  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('0');
  const [listedDate, setListedDate] = useState(todayIsoDate());
  const [stock, setStock] = useState('1');
  const [description, setDescription] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string>('');

  const visibleListings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...listings]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((listing) => {
        if (!q) return true;
        return (
          listing.title.toLowerCase().includes(q)
          || listing.description.toLowerCase().includes(q)
          || listing.sellerName.toLowerCase().includes(q)
        );
      });
  }, [listings, query]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  };

  const resetForm = () => {
    setTitle('');
    setPrice('0');
    setListedDate(todayIsoDate());
    setStock('1');
    setDescription('');
    setImageDataUrl('');
  };

  const handleCreateListing = () => {
    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();
    const normalizedPrice = Number(price);
    const normalizedStock = Number(stock);

    if (!normalizedTitle || !Number.isFinite(normalizedPrice) || normalizedPrice < 0 || !Number.isFinite(normalizedStock) || normalizedStock < 0) {
      flash('Fill in a valid title, price, and stock.');
      return;
    }

    addListing({
      title: normalizedTitle,
      description: normalizedDescription,
      price: normalizedPrice,
      currency: 'USD',
      listedDate: listedDate || todayIsoDate(),
      imageDataUrl: imageDataUrl || undefined,
      sellerId: userId,
      sellerName: displayName,
      stock: normalizedStock,
    });

    flash('Listing created.');
    resetForm();
    setShowSellForm(false);
  };

  return (
    <div className="shop-page">
      <header className="shop-page__header">
        <button className="shop-page__back" onClick={() => setScreen('main')}>
          <ArrowLeft size={18} />
        </button>
        <Shield size={18} />
        <h1>Ridgeline Shop</h1>
      </header>

      <div className="shop-page__toolbar">
        <div className="shop-page__search-wrap">
          <Search size={14} />
          <input
            className="shop-page__search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search listings, descriptions, sellers..."
          />
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowSellForm((open) => !open)}>
          <Plus size={14} /> {showSellForm ? 'Close Seller Form' : 'Sell Item'}
        </Button>
      </div>

      {showSellForm && (
        <section className="shop-page__sell-form">
          <h2>Create Listing</h2>
          <div className="shop-page__form-grid">
            <label>
              Item title
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Custom keyboard" />
            </label>
            <label>
              Price (USD)
              <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label>
              Date
              <input type="date" value={listedDate} onChange={(e) => setListedDate(e.target.value)} />
            </label>
            <label>
              Stock
              <input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} />
            </label>
            <label className="shop-page__form-file">
              Product image
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    setImageDataUrl(await fileToDataUrl(file));
                  } catch {
                    flash('Could not read image file.');
                  }
                }}
              />
            </label>
            <label className="shop-page__form-description">
              Description
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                placeholder="Condition, accessories, shipping notes..."
              />
            </label>
          </div>
          {imageDataUrl && <img src={imageDataUrl} alt="Preview" className="shop-page__image-preview" />}
          <div className="shop-page__form-actions">
            <Button variant="ghost" size="sm" onClick={resetForm}>Reset</Button>
            <Button variant="primary" size="sm" onClick={handleCreateListing}>Publish Listing</Button>
          </div>
        </section>
      )}

      <section className="shop-page__grid">
        {visibleListings.length === 0 && (
          <div className="shop-page__empty">No listings yet. Start by creating one.</div>
        )}

        {visibleListings.map((listing) => {
          const isSeller = listing.sellerId === userId;
          const soldOut = listing.stock <= 0;
          return (
            <article key={listing.id} className="shop-card">
              <div className="shop-card__media">
                {listing.imageDataUrl
                  ? <img src={listing.imageDataUrl} alt={listing.title} />
                  : <div className="shop-card__placeholder">No image</div>}
              </div>
              <div className="shop-card__body">
                <div className="shop-card__top">
                  <h3>{listing.title}</h3>
                  <span>${listing.price.toFixed(2)}</span>
                </div>
                <p className="shop-card__desc">{listing.description || 'No description provided.'}</p>
                <div className="shop-card__meta">
                  <span>Seller: {listing.sellerName}</span>
                  <span>Date: {listing.listedDate}</span>
                  <span>Stock: {listing.stock}</span>
                </div>
                <div className="shop-card__actions">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={soldOut}
                    onClick={() => {
                      const ok = buyListing(listing.id, 1);
                      flash(ok ? `Purchased ${listing.title}.` : `Could not buy ${listing.title}.`);
                    }}
                  >
                    {soldOut ? 'Sold Out' : 'Buy'}
                  </Button>
                  {isSeller && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        removeListing(listing.id);
                        flash('Listing removed.');
                      }}
                    >
                      <Trash size={14} /> Remove
                    </Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {toast && <div className="shop-page__toast">{toast}</div>}
    </div>
  );
}
