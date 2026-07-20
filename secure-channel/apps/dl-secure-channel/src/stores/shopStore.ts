import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ShopListing {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: 'USD';
  listedDate: string;
  imageDataUrl?: string;
  sellerId: string;
  sellerName: string;
  stock: number;
  createdAt: number;
  updatedAt: number;
}

interface ShopState {
  listings: ShopListing[];
  addListing: (input: Omit<ShopListing, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateListing: (id: string, patch: Partial<Omit<ShopListing, 'id' | 'createdAt' | 'sellerId' | 'sellerName'>>) => void;
  removeListing: (id: string) => void;
  buyListing: (id: string, quantity?: number) => boolean;
}

export const useShopStore = create<ShopState>()(persist((set, get) => ({
  listings: [],

  addListing: (input) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const listing: ShopListing = {
      ...input,
      id,
      createdAt: now,
      updatedAt: now,
      stock: Math.max(0, Math.floor(input.stock || 0)),
      price: Number.isFinite(input.price) ? Math.max(0, Number(input.price)) : 0,
    };

    set((state) => ({
      listings: [listing, ...state.listings],
    }));

    return id;
  },

  updateListing: (id, patch) => {
    set((state) => ({
      listings: state.listings.map((listing) => {
        if (listing.id !== id) return listing;
        return {
          ...listing,
          ...patch,
          ...(typeof patch.stock === 'number' ? { stock: Math.max(0, Math.floor(patch.stock)) } : {}),
          ...(typeof patch.price === 'number' ? { price: Math.max(0, Number(patch.price)) } : {}),
          updatedAt: Date.now(),
        };
      }),
    }));
  },

  removeListing: (id) => {
    set((state) => ({
      listings: state.listings.filter((listing) => listing.id !== id),
    }));
  },

  buyListing: (id, quantity = 1) => {
    const qty = Math.max(1, Math.floor(quantity));
    const listing = get().listings.find((item) => item.id === id);
    if (!listing || listing.stock < qty) return false;

    set((state) => ({
      listings: state.listings.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          stock: Math.max(0, item.stock - qty),
          updatedAt: Date.now(),
        };
      }),
    }));

    return true;
  },
}), {
  name: 'dl-shop',
}));
