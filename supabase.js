/**
 * ============================================
 * USTAD — supabase.js
 * Fichier partagé par toutes les pages
 * Inclure AVANT tout autre script :
 * <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 * <script src="supabase.js"></script>
 * ============================================
 */

const SUPABASE_URL  = 'https://phcsftysslpiiisqjwhi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoY3NmdHlzc2xwaWlpc3Fqd2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MjU1ODMsImV4cCI6MjA4OTIwMTU4M30.8reYXjUdrgjLpxgsYsAfP3H0yf_wTABQHZDYWY_fS8Q';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ============================================
   AUTH HELPERS
   ============================================ */

/** Retourne la session active ou null */
async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

/** Retourne le profil complet de l'utilisateur connecté */
async function getCurrentProfile() {
  const session = await getSession();
  if (!session) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  return data;
}

/** Redirige vers auth.html si non connecté */
async function requireAuth() {
  const session = await getSession();
  if (!session) { window.location.href = 'auth.html'; return null; }
  return session;
}

/** Redirige selon le rôle après connexion */
async function redirectByRole() {
  const profile = await getCurrentProfile();
  if (!profile) { window.location.href = 'auth.html'; return; }
  if (profile.role === 'tutor')   window.location.href = 'dashboard-tutor.html';
  else if (profile.role === 'student') window.location.href = 'dashboard-student.html';
  else window.location.href = 'index.html';
}

/** Déconnexion */
async function logout() {
  await sb.auth.signOut();
  window.location.href = 'auth.html';
}

/* ============================================
   TUTORS
   ============================================ */

/** Récupère tous les tuteurs actifs avec leur profil */
async function getTutors({ subject, level, maxPrice, limit = 20 } = {}) {
  let query = sb
    .from('tutors')
    .select(`
      *,
      profile:profiles(id, full_name, city, avatar_url)
    `)
    .eq('is_active', true)
    .eq('is_verified', true)
    .order('rating_avg', { ascending: false })
    .limit(limit);

  if (maxPrice) query = query.lte('price_solo', maxPrice);

  const { data, error } = await query;
  if (error) { console.error('getTutors:', error); return []; }

  // Filter by subject/level in JS (arrays in Postgres need contains)
  let result = data || [];
  if (subject) result = result.filter(t => t.subjects?.includes(subject));
  if (level)   result = result.filter(t => t.levels?.includes(level));
  return result;
}

/** Récupère un tuteur par son ID */
async function getTutorById(id) {
  const { data, error } = await sb
    .from('tutors')
    .select(`*, profile:profiles(*)`)
    .eq('id', id)
    .single();
  if (error) { console.error('getTutorById:', error); return null; }
  return data;
}

/** Récupère les avis d'un tuteur */
async function getTutorReviews(tutorId, limit = 10) {
  const { data, error } = await sb
    .from('reviews')
    .select(`*, student:profiles(full_name)`)
    .eq('tutor_id', tutorId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('getTutorReviews:', error); return []; }
  return data || [];
}

/** Met à jour le profil tuteur */
async function updateTutorProfile(tutorId, updates) {
  const { error } = await sb.from('tutors').upsert({ id: tutorId, ...updates });
  if (error) throw error;
}

/* ============================================
   STUDENTS
   ============================================ */

/** Récupère le profil étudiant avec son abonnement actif */
async function getStudentData(studentId) {
  const [profileRes, bookingRes] = await Promise.all([
    sb.from('profiles').select('*').eq('id', studentId).single(),
    sb.from('bookings')
      .select(`*, tutor:tutors(*, profile:profiles(full_name, avatar_url))`)
      .eq('student_id', studentId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
  ]);
  return {
    profile:  profileRes.data,
    booking:  bookingRes.data,
  };
}

/* ============================================
   BOOKINGS
   ============================================ */

/** Crée une nouvelle réservation */
async function createBooking({ studentId, tutorId, offerType, c1Day, c1Hour, c2Day, c2Hour, monthlyPrice }) {
  const { data, error } = await sb.from('bookings').insert({
    student_id:    studentId,
    tutor_id:      tutorId,
    offer_type:    offerType,   // 'solo' | 'class3' | 'class5'
    c1_day:        c1Day,
    c1_hour:       c1Hour,
    c2_day:        c2Day,
    c2_hour:       c2Hour,
    monthly_price: monthlyPrice,
    status:        'pending',
  }).select().single();
  if (error) throw error;
  return data;
}

/** Récupère les réservations d'un tuteur */
async function getTutorBookings(tutorId) {
  const { data, error } = await sb
    .from('bookings')
    .select(`*, student:profiles(full_name, phone, city)`)
    .eq('tutor_id', tutorId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getTutorBookings:', error); return []; }
  return data || [];
}

/** Récupère les réservations d'un étudiant */
async function getStudentBookings(studentId) {
  const { data, error } = await sb
    .from('bookings')
    .select(`*, tutor:tutors(price_solo, profile:profiles(full_name))`)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getStudentBookings:', error); return []; }
  return data || [];
}

/** Confirme une réservation (tuteur uniquement) */
async function confirmBooking(bookingId) {
  const { error } = await sb
    .from('bookings')
    .update({ status: 'confirmed', started_at: new Date().toISOString().split('T')[0] })
    .eq('id', bookingId);
  if (error) throw error;
}

/** Annule une réservation */
async function cancelBooking(bookingId) {
  const { error } = await sb
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId);
  if (error) throw error;
}

/* ============================================
   REVIEWS
   ============================================ */

/** Crée un avis après une session */
async function createReview({ bookingId, studentId, tutorId, rating, comment, subject, level }) {
  const { data, error } = await sb.from('reviews').insert({
    booking_id: bookingId,
    student_id: studentId,
    tutor_id:   tutorId,
    rating, comment, subject, level,
  }).select().single();
  if (error) throw error;

  // Met à jour la note moyenne du tuteur
  await updateTutorRating(tutorId);
  return data;
}

/** Recalcule et met à jour la note moyenne d'un tuteur */
async function updateTutorRating(tutorId) {
  const { data } = await sb
    .from('reviews')
    .select('rating')
    .eq('tutor_id', tutorId);
  if (!data?.length) return;
  const avg = data.reduce((s, r) => s + r.rating, 0) / data.length;
  await sb.from('tutors').update({
    rating_avg:   Math.round(avg * 10) / 10,
    rating_count: data.length,
  }).eq('id', tutorId);
}

/* ============================================
   PROFILES
   ============================================ */

/** Met à jour le profil utilisateur */
async function updateProfile(userId, updates) {
  const { error } = await sb.from('profiles').update(updates).eq('id', userId);
  if (error) throw error;
}

/** Upload une photo de profil */
async function uploadAvatar(userId, file) {
  const ext  = file.name.split('.').pop();
  const path = `avatars/${userId}.${ext}`;
  const { error: uploadError } = await sb.storage.from('avatars').upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  await updateProfile(userId, { avatar_url: data.publicUrl });
  return data.publicUrl;
}

/* ============================================
   ADMIN
   ============================================ */

/** Récupère tous les tuteurs (admin) */
async function adminGetTutors() {
  const { data, error } = await sb
    .from('tutors')
    .select(`*, profile:profiles(full_name, email, city, created_at)`)
    .order('created_at', { ascending: false });
  if (error) { console.error('adminGetTutors:', error); return []; }
  return data || [];
}

/** Récupère tous les étudiants (admin) */
async function adminGetStudents() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .order('created_at', { ascending: false });
  if (error) { console.error('adminGetStudents:', error); return []; }
  return data || [];
}

/** Récupère toutes les réservations (admin) */
async function adminGetBookings() {
  const { data, error } = await sb
    .from('bookings')
    .select(`
      *,
      student:profiles!student_id(full_name),
      tutor:tutors!tutor_id(profile:profiles(full_name))
    `)
    .order('created_at', { ascending: false });
  if (error) { console.error('adminGetBookings:', error); return []; }
  return data || [];
}

/** Approuve un tuteur */
async function adminApproveTutor(tutorId) {
  const { error } = await sb.from('tutors').update({ is_verified: true, is_active: true }).eq('id', tutorId);
  if (error) throw error;
}

/** Suspend un tuteur */
async function adminSuspendTutor(tutorId) {
  const { error } = await sb.from('tutors').update({ is_active: false }).eq('id', tutorId);
  if (error) throw error;
}

/** Stats globales pour l'admin */
async function adminGetStats() {
  const [tutors, students, bookings, reviews] = await Promise.all([
    sb.from('tutors').select('id', { count: 'exact' }).eq('is_active', true),
    sb.from('profiles').select('id', { count: 'exact' }).eq('role', 'student'),
    sb.from('bookings').select('monthly_price').eq('status', 'confirmed'),
    sb.from('reviews').select('rating'),
  ]);

  const revenue      = (bookings.data || []).reduce((s, b) => s + (b.monthly_price || 0), 0);
  const commission   = Math.round(revenue * 0.25);
  const avgRating    = reviews.data?.length
    ? (reviews.data.reduce((s, r) => s + r.rating, 0) / reviews.data.length).toFixed(1)
    : 0;
  const pendingTutors = await sb.from('tutors').select('id', { count: 'exact' }).eq('is_verified', false);

  return {
    totalTutors:    tutors.count    || 0,
    totalStudents:  students.count  || 0,
    monthlyRevenue: revenue,
    commission,
    avgRating,
    pendingTutors:  pendingTutors.count || 0,
  };
}

/* ============================================
   REALTIME — écoute les nouvelles réservations
   ============================================ */

/** Écoute les nouvelles réservations en temps réel (pour tuteur) */
function listenToBookings(tutorId, callback) {
  return sb
    .channel('bookings-channel')
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'bookings',
      filter: `tutor_id=eq.${tutorId}`,
    }, payload => callback(payload.new))
    .subscribe();
}

/** Écoute les nouveaux messages (pour messagerie future) */
function listenToMessages(userId, callback) {
  return sb
    .channel('messages-channel')
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'messages',
      filter: `receiver_id=eq.${userId}`,
    }, payload => callback(payload.new))
    .subscribe();
}

/* ============================================
   UTILS
   ============================================ */

/** Formate un prix en DH */
function formatPrice(amount) {
  return amount?.toLocaleString('fr-MA') + ' DH';
}

/** Formate une date en français */
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

/** Génère les initiales depuis un nom complet */
function getInitials(fullName) {
  return (fullName || 'UA').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

/** Affiche un toast de notification */
function showToast(msg, duration = 2800) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#0f172a;color:#fff;padding:11px 16px;border-radius:9px;font-size:.82rem;font-weight:600;z-index:9999;opacity:0;transform:translateY(8px);transition:all .22s;pointer-events:none;font-family:Inter,sans-serif;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translateY(0)';
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
  }, duration);
}
