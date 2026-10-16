import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * 重打包 APK：读取 aapt2 产出的 base.apk，把 classes.dex 与 assets/web/** 写进去，
 * 重新输出一个带正确 CRC/尺寸的干净 zip（Android 对 APK 内的 zip 结构有校验，
 * 用普通 zip 工具追加会签名失败，所以这里手工构建条目）。
 *
 * 用法：java ApkBuilder base.apk out.apk classes.dex assetsDir
 */
public class ApkBuilder {

    public static void main(String[] args) throws Exception {
        String inPath = args[0];
        String outPath = args[1];
        String dexPath = args[2];
        String assetsDir = args[3];

        Map<String, byte[]> entries = new LinkedHashMap<String, byte[]>();
        Map<String, Integer> methods = new LinkedHashMap<String, Integer>();

        ZipInputStream zis = new ZipInputStream(new FileInputStream(inPath));
        ZipEntry e;
        byte[] buf = new byte[65536];
        while ((e = zis.getNextEntry()) != null) {
            if (e.isDirectory()) {
                continue;
            }
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            int n;
            while ((n = zis.read(buf)) > 0) {
                bos.write(buf, 0, n);
            }
            entries.put(e.getName(), bos.toByteArray());
            methods.put(e.getName(), e.getMethod());
        }
        zis.close();

        entries.put("classes.dex", readFile(new File(dexPath)));
        methods.put("classes.dex", ZipEntry.DEFLATED);

        File root = new File(assetsDir);
        collect(root, root, entries, methods);

        ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(outPath));
        for (Map.Entry<String, byte[]> en : entries.entrySet()) {
            byte[] data = en.getValue();
            ZipEntry ze = new ZipEntry(en.getKey());
            Integer m = methods.get(en.getKey());
            ze.setMethod(m == null ? ZipEntry.DEFLATED : m.intValue());
            ze.setSize(data.length);
            CRC32 crc = new CRC32();
            crc.update(data);
            ze.setCrc(crc.getValue());
            zos.putNextEntry(ze);
            zos.write(data);
            zos.closeEntry();
        }
        zos.finish();
        zos.close();
        System.out.println("APK_REBUILT entries=" + entries.size());
    }

    /** 递归收集 assets 目录下的所有文件，路径写成 assets/xxx。 */
    private static void collect(File root, File dir, Map<String, byte[]> entries,
                                Map<String, Integer> methods) throws Exception {
        File[] children = dir.listFiles();
        if (children == null) {
            return;
        }
        for (File f : children) {
            if (f.isDirectory()) {
                collect(root, f, entries, methods);
            } else {
                String rel = root.toURI().relativize(f.toURI()).getPath();
                entries.put("assets/" + rel, readFile(f));
                methods.put("assets/" + rel, ZipEntry.DEFLATED);
            }
        }
    }

    private static byte[] readFile(File f) throws Exception {
        byte[] data = new byte[(int) f.length()];
        FileInputStream in = new FileInputStream(f);
        int off = 0;
        while (off < data.length) {
            int n = in.read(data, off, data.length - off);
            if (n < 0) {
                break;
            }
            off += n;
        }
        in.close();
        return data;
    }
}
