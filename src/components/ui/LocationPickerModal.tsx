import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Navigation, X, Loader2, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../../lib/direction';
import { useToast } from '../../contexts/ToastContext';

// نفس إصلاح أيقونة العلامة الافتراضية الموجود في Onboarding.tsx (Leaflet +
// Vite لا يحلاّن مسار الصورة تلقائياً بدونه).
const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

const DEFAULT_CENTER: [number, number] = [24.7136, 46.6753]; // الرياض

function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

function ClickableMarker({
  position,
  onPick,
}: {
  position: [number, number] | null;
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return position ? <Marker position={position} /> : null;
}

async function reverseGeocode(lat: number, lng: number, lang: string): Promise<{ address: string; city: string }> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=${lang || 'ar'}`
    );
    const data = await res.json();
    const address = data?.display_name || '';
    const city = data?.address
      ? (data.address.city || data.address.town || data.address.village || data.address.state || '')
      : '';
    return { address, city };
  } catch {
    return { address: '', city: '' };
  }
}

/**
 * نافذة اختيار موقع مشتركة (Leaflet + OpenStreetMap، بلا أي مفتاح API) --
 * نفس نمط الخريطة الموجود فعلاً في Onboarding.tsx (نقر + عكس ترميز جغرافي
 * عبر Nominatim)، مُستخرَج هنا ليُستخدَم في أكثر من شاشة بلا تكرار، مع إضافة
 * زر "تحديد موقعي الحالي" (navigator.geolocation) غير الموجود هناك.
 *
 * تُرجِع فقط العنوان/المدينة النصيين عبر onConfirm -- لا تحفظ إحداثيات
 * (lat/lng) في أي مكان؛ هذا متعمَّد: لا عمود lat/lng في جدول tenants أصلاً،
 * وOnboarding.tsx نفسه يلتقط الإحداثيات محلياً فقط دون حفظها، فهذا المكوّن
 * يطابق نفس النطاق الفعلي المستخدَم اليوم بدل توسيعه بلا حاجة مؤكَّدة.
 */
export default function LocationPickerModal({
  initialLat,
  initialLng,
  onConfirm,
  onClose,
}: {
  initialLat?: number;
  initialLng?: number;
  onConfirm: (result: { address: string; city: string }) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { dir } = useDirection();
  const { error: toastError } = useToast();

  const [position, setPosition] = useState<[number, number] | null>(
    initialLat != null && initialLng != null ? [initialLat, initialLng] : null
  );
  const [resolved, setResolved] = useState<{ address: string; city: string }>({ address: '', city: '' });
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);

  const handlePick = async (lat: number, lng: number) => {
    setPosition([lat, lng]);
    setResolving(true);
    const result = await reverseGeocode(lat, lng, i18n.language);
    setResolved(result);
    setResolving(false);
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toastError(t('location_picker.geolocation_unsupported'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await handlePick(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => {
        toastError(t('location_picker.geolocation_denied'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleConfirm = () => {
    if (!position) return;
    onConfirm({ address: resolved.address, city: resolved.city });
    onClose();
  };

  const center = position || DEFAULT_CENTER;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-surface w-full max-w-xl rounded-[2rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
        dir={dir}
      >
        <div className="p-4 sm:p-6 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <h2 className="text-lg font-black text-content">{t('location_picker.title')}</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors">
            <X size={20} className="text-content-muted" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={locating}
            className="w-full px-4 py-2.5 bg-brand/10 text-brand border border-brand/20 rounded-xl flex items-center justify-center gap-2 font-bold text-sm hover:bg-brand/15 transition-all disabled:opacity-60 cursor-pointer"
          >
            {locating ? <Loader2 size={16} className="animate-spin" /> : <Navigation size={16} />}
            {t('location_picker.use_current_location')}
          </button>

          <div className="h-[280px] sm:h-[340px] w-full rounded-2xl overflow-hidden border-2 border-white bg-white relative z-0 shadow-md">
            <MapContainer
              center={center}
              zoom={position ? 15 : 6}
              style={{ height: '100%', width: '100%', zIndex: 0 }}
              scrollWheelZoom={false}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <MapRecenter center={center} />
              <ClickableMarker position={position} onPick={handlePick} />
            </MapContainer>
          </div>

          <div className="bg-surface-muted/60 rounded-xl p-3 text-xs font-bold text-content min-h-[40px] flex items-center">
            {resolving ? (
              <span className="flex items-center gap-2 text-content-muted">
                <Loader2 size={14} className="animate-spin" /> {t('location_picker.resolving')}
              </span>
            ) : position ? (
              resolved.address || t('location_picker.no_address_found')
            ) : (
              <span className="text-content-muted">{t('location_picker.instructions')}</span>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 shrink-0 p-4 sm:p-6 border-t border-border bg-surface flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-surface-muted text-content hover:bg-surface border border-border rounded-xl font-bold text-sm transition-all cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!position}
            className="px-6 py-2.5 bg-brand hover:bg-brand/90 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-brand/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <Check size={16} />
            {t('common.confirm')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
