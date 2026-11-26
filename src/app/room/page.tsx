import RoomClient from "@/components/RoomClient";

/** One static page for every room: the room code travels in the URL fragment (/room/#ABCD2345). */
export default function RoomPage() {
  return <RoomClient />;
}
