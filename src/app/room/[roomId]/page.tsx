import RoomClient from '@/components/RoomClient';

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ n?: string }>;
}) {
  const { roomId } = await params;
  const { n } = await searchParams;
  return <RoomClient roomId={roomId} roomName={n} />;
}
