import { Feed } from "../components/feed/Feed";
import { PostComposer } from "../components/feed/PostComposer";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
      <PostComposer />
      <Feed />
    </div>
  );
}
